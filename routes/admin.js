const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.use(requireAdmin);

router.get('/', async (req, res) => {
  const stats = await db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM members WHERE is_active = 1) as total_members,
      (SELECT COUNT(*) FROM cycles) as total_cycles,
      (SELECT COUNT(*) FROM loans WHERE status = 'active') as active_loans
  `).get();

  const fundBalances = await db.prepare(`
    SELECT f.id, f.name, COALESCE(SUM(mb.balance), 0) as total
    FROM fund_types f
    LEFT JOIN member_balances mb ON mb.fund_type_id = f.id
    GROUP BY f.id ORDER BY f.id
  `).all();

  const pendingContribs = (await db.prepare("SELECT COUNT(*) as c FROM contributions WHERE status = 'pending' AND amount > 0").get()).c;
  const pendingLoans = (await db.prepare("SELECT COUNT(*) as c FROM loans WHERE status = 'pending'").get()).c;
  const pendingPayments = (await db.prepare("SELECT COUNT(*) as c FROM payment_requests WHERE status = 'pending'").get()).c;

  const totalFines = (await db.prepare("SELECT COALESCE(SUM(balance),0) as t FROM fines WHERE status='pending'").get()).t;
  const totalMemberCard = (await db.prepare("SELECT COALESCE(SUM(assigned_amount - paid_amount),0) as t FROM member_cards").get()).t;

  const recentContributions = await db.prepare(`
    SELECT c.amount, f.name as fund, m.first_name || ' ' || m.last_name as member, c.created_at, c.status
    FROM contributions c
    JOIN fund_types f ON c.fund_type_id = f.id
    JOIN members m ON c.member_id = m.id
    ORDER BY c.created_at DESC LIMIT 10
  `).all();

  res.renderWithLayout('admin/dashboard', { stats, fundBalances, pendingContribs, pendingLoans, pendingPayments, totalFines, totalMemberCard, recentContributions });
});

router.get('/approvals', async (req, res) => {
  const pendingContributions = await db.prepare(`
    SELECT c.id, c.amount, c.created_at, f.name as fund, m.first_name, m.last_name, m.member_number, cy.start_date, cy.end_date
    FROM contributions c
    JOIN fund_types f ON c.fund_type_id = f.id
    JOIN members m ON c.member_id = m.id
    JOIN cycles cy ON c.cycle_id = cy.id
    WHERE c.status = 'pending' AND c.amount > 0
    ORDER BY c.created_at ASC
  `).all();

  const pendingLoans = await db.prepare(`
    SELECT l.*, m.first_name, m.last_name, m.member_number
    FROM loans l
    JOIN members m ON l.member_id = m.id
    WHERE l.status = 'pending'
    ORDER BY l.created_at ASC
  `).all();

  const pendingPayments = await db.prepare(`
    SELECT pr.*, m.first_name, m.last_name, m.member_number,
      CASE
        WHEN pr.payment_type = 'fine' THEN COALESCE((SELECT reason FROM fines WHERE id = pr.reference_id), 'Fine Repayment')
        WHEN pr.payment_type = 'loan' THEN 'Loan Repayment'
        ELSE 'Member Card Repayment'
      END as description
    FROM payment_requests pr
    JOIN members m ON pr.member_id = m.id
    WHERE pr.status = 'pending'
    ORDER BY pr.created_at ASC
  `).all();

  res.renderWithLayout('admin/approvals', { pendingContributions, pendingLoans, pendingPayments });
});

router.post('/contributions/approve/:id', async (req, res) => {
  const contrib = await db.prepare("SELECT * FROM contributions WHERE id = ? AND status = 'pending'").get(req.params.id);
  if (!contrib) return res.redirect('/admin/approvals');

  await db.transaction(async () => {
    await db.prepare("UPDATE contributions SET status = 'approved' WHERE id = ?").run(contrib.id);
    await db.prepare(`
      INSERT INTO member_balances (member_id, fund_type_id, balance)
      VALUES (?, ?, ?)
      ON CONFLICT(member_id, fund_type_id) DO UPDATE SET balance = balance + ?
    `).run(contrib.member_id, contrib.fund_type_id, contrib.amount, contrib.amount);
  })();
  auditLog(req.session.user, 'approve', 'contribution', contrib.id, 'KES ' + contrib.amount + ' fund ' + contrib.fund_type_id);
  await notify(contrib.member_id, 'Contribution Approved', 'KES ' + contrib.amount.toLocaleString() + ' contribution approved', 'success', '/member');

  res.redirect('/admin/approvals');
});

router.post('/contributions/reject/:id', async (req, res) => {
  const contrib = await db.prepare("SELECT * FROM contributions WHERE id = ? AND status = 'pending'").get(req.params.id);
  await db.prepare("UPDATE contributions SET status = 'rejected' WHERE id = ? AND status = 'pending'").run(req.params.id);
  if (contrib) { await notify(contrib.member_id, 'Contribution Rejected', 'KES ' + contrib.amount.toLocaleString() + ' contribution was rejected', 'error', '/member/contribute');
    auditLog(req.session.user, 'reject', 'contribution', contrib.id, 'KES ' + contrib.amount + ' rejected'); }
  res.redirect('/admin/approvals');
});

router.post('/loans/approve/:id', async (req, res) => {
  const loan = await db.prepare("SELECT * FROM loans WHERE id = ? AND status = 'pending'").get(req.params.id);
  if (!loan) return res.redirect('/admin/approvals');

  const today = new Date().toISOString().split('T')[0];
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const dueDateStr = dueDate.toISOString().split('T')[0];

  const amountDue = loan.amount + (loan.amount * loan.interest_rate / 100);

  await db.prepare(`
    UPDATE loans SET status = 'active', amount_due = ?, issued_date = ?, due_date = ?, approved_date = ?
    WHERE id = ?
  `).run(amountDue, today, dueDateStr, today, loan.id);

  await notify(loan.member_id, 'Loan Approved', 'KES ' + loan.amount.toLocaleString() + ' loan approved at 10% interest. Due: ' + dueDateStr, 'success', '/member/loans');
  auditLog(req.session.user, 'approve', 'loan', loan.id, 'KES ' + loan.amount + ' approved, due ' + dueDateStr);

  res.redirect('/admin/approvals');
});

router.post('/loans/reject/:id', async (req, res) => {
  const loan = await db.prepare("SELECT * FROM loans WHERE id = ? AND status = 'pending'").get(req.params.id);
  await db.prepare("UPDATE loans SET status = 'rejected' WHERE id = ? AND status = 'pending'").run(req.params.id);
  if (loan) { await notify(loan.member_id, 'Loan Rejected', 'KES ' + loan.amount.toLocaleString() + ' loan application was rejected', 'error', '/member/loans');
    auditLog(req.session.user, 'reject', 'loan', loan.id, 'KES ' + loan.amount + ' rejected'); }
  res.redirect('/admin/approvals');
});

router.get('/members', async (req, res) => {
  const members = await db.prepare(`
    SELECT m.*, u.username, u.role,
      (SELECT COALESCE(SUM(balance), 0) FROM member_balances WHERE member_id = m.id) as total_balance
    FROM members m
    LEFT JOIN users u ON u.member_id = m.id
    ORDER BY m.member_number
  `).all();
  res.renderWithLayout('admin/members', { members, message: null, error: null });
});

router.post('/members/add', async (req, res) => {
  const { first_name, last_name, phone, username, password } = req.body;
  if (!first_name || !last_name || !username || !password) {
    const members = await db.prepare('SELECT * FROM members ORDER BY member_number').all();
    return res.renderWithLayout('admin/members', { members, message: null, error: 'All fields required' });
  }
  if (password.length < 6) {
    const members = await db.prepare('SELECT * FROM members ORDER BY member_number').all();
    return res.renderWithLayout('admin/members', { members, message: null, error: 'Password must be at least 6 characters' });
  }

  try {
    await db.transaction(async () => {
      const count = (await db.prepare('SELECT COUNT(*) as c FROM members').get()).c;
      const num = `MEM${String(count + 1).padStart(3, '0')}`;
      const result = await db.prepare('INSERT INTO members (first_name, last_name, phone, member_number) VALUES (?, ?, ?, ?)').run(first_name, last_name, phone || null, num);
      const memberId = result.lastInsertRowid;
      const hash = bcrypt.hashSync(password, 10);
      await db.prepare('INSERT INTO users (username, password_hash, role, member_id) VALUES (?, ?, ?, ?)').run(username, hash, 'member', memberId);
      for (let f = 1; f <= 4; f++) {
        await db.prepare('INSERT INTO member_balances (member_id, fund_type_id, balance) VALUES (?, ?, 0)').run(memberId, f);
      }
    })();
    res.redirect('/admin/members');
  } catch (e) {
    const members = await db.prepare('SELECT * FROM members ORDER BY member_number').all();
    res.renderWithLayout('admin/members', { members, message: null, error: 'Username already exists' });
  }
});

router.post('/members/reset-password/:id', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.redirect('/admin/members');
  const hash = bcrypt.hashSync(password, 10);
  await db.prepare('UPDATE users SET password_hash = ? WHERE member_id = ?').run(hash, req.params.id);
  auditLog(req.session.user, 'reset_password', 'member', req.params.id, 'Password reset');
  res.redirect('/admin/members');
});

router.post('/members/photo/:id', async (req, res) => {
  const { photo } = req.body;
  if (!photo) return res.redirect('/admin/members');
  await db.prepare('UPDATE members SET photo = ? WHERE id = ?').run(photo, req.params.id);
  auditLog(req.session.user, 'upload_photo', 'member', req.params.id, 'Photo uploaded');
  res.redirect('/admin/members');
});

router.post('/members/photo/remove/:id', async (req, res) => {
  await db.prepare('UPDATE members SET photo = NULL WHERE id = ?').run(req.params.id);
  res.redirect('/admin/members');
});

router.get('/cycles', async (req, res) => {
  const cycles = await db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM contributions WHERE cycle_id = c.id) as contrib_count,
      (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE cycle_id = c.id) as contrib_total
    FROM cycles c ORDER BY c.start_date DESC
  `).all();
  const currentCycle = await db.prepare('SELECT * FROM cycles WHERE is_open = 1 AND is_processed = 0 ORDER BY start_date DESC LIMIT 1').get();
  res.renderWithLayout('admin/cycles', { cycles, currentCycle });
});

router.post('/cycles/create', async (req, res) => {
  const { start_date, end_date } = req.body;
  await db.prepare('UPDATE cycles SET is_open = 0 WHERE is_open = 1').run();
  await db.prepare('INSERT INTO cycles (start_date, end_date, is_open, is_processed) VALUES (?, ?, 1, 0)').run(start_date, end_date);
  res.redirect('/admin/cycles');
});

router.post('/cycles/close', async (req, res) => {
  await db.prepare('UPDATE cycles SET is_open = 0 WHERE is_open = 1').run();
  res.redirect('/admin/cycles');
});

router.get('/loans', async (req, res) => {
  const loans = await db.prepare(`
    SELECT l.*, m.first_name, m.last_name, m.member_number 
    FROM loans l 
    JOIN members m ON l.member_id = m.id 
    ORDER BY l.created_at DESC
  `).all();
  res.renderWithLayout('admin/loans', { loans });
});

router.post('/loans/process-overdue', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const overdue = await db.prepare("SELECT * FROM loans WHERE status = 'active' AND due_date < ? AND date(due_date, '+30 days') <= ?").all(today, today);
  const update = db.prepare("UPDATE loans SET amount_due = amount_due + (amount_due * interest_rate / 100), status = 'defaulted' WHERE id = ?");
  await db.transaction(async () => {
    for (const loan of overdue) {
      await update.run(loan.id);
    }
  })();
  res.redirect('/admin/loans');
});

router.get('/fines', async (req, res) => {
  const fines = await db.prepare(`
    SELECT f.*, m.first_name, m.last_name, m.member_number
    FROM fines f
    JOIN members m ON f.member_id = m.id
    ORDER BY f.created_at DESC
  `).all();
  const members = await db.prepare("SELECT id, first_name, last_name, member_number FROM members WHERE is_active = 1").all();
  res.renderWithLayout('admin/fines', { fines, members, message: null });
});

router.post('/fines/add', async (req, res) => {
  const { member_id, amount, reason } = req.body;
  if (!member_id || !amount || amount <= 0) return res.redirect('/admin/fines');
  const r = await db.prepare('INSERT INTO fines (member_id, amount, balance, reason, status) VALUES (?, ?, ?, ?, ?)').run(member_id, amount, amount, reason || 'Late penalty', 'pending');
  auditLog(req.session.user, 'create', 'fine', r.lastInsertRowid, 'KES ' + amount + ' fine for member ' + member_id);
  res.redirect('/admin/fines');
});

router.get('/membercard', async (req, res) => {
  const cards = await db.prepare(`
    SELECT mc.*, m.first_name, m.last_name, m.member_number
    FROM member_cards mc
    JOIN members m ON mc.member_id = m.id
    ORDER BY mc.created_at DESC
  `).all();
  const members = await db.prepare(`
    SELECT m.id, m.first_name, m.last_name, m.member_number,
      COALESCE(mc.assigned_amount, 0) as assigned, COALESCE(mc.paid_amount, 0) as paid
    FROM members m
    LEFT JOIN member_cards mc ON mc.member_id = m.id
    WHERE m.is_active = 1 ORDER BY m.member_number
  `).all();
  res.renderWithLayout('admin/membercard', { cards, members, message: null });
});

router.post('/membercard/assign', async (req, res) => {
  const { member_id, amount } = req.body;
  if (!member_id || !amount || amount <= 0) return res.redirect('/admin/membercard');
  await db.prepare(`
    INSERT INTO member_cards (member_id, assigned_amount, paid_amount)
    VALUES (?, ?, 0)
    ON CONFLICT(member_id) DO UPDATE SET assigned_amount = assigned_amount + ?
  `).run(member_id, amount, amount);
  auditLog(req.session.user, 'assign', 'member_card', member_id, 'KES ' + amount + ' assigned');
  res.redirect('/admin/membercard');
});

router.get('/reports', async (req, res) => {
  const fundBalances = await db.prepare(`
    SELECT f.name, COALESCE(SUM(mb.balance), 0) as total
    FROM fund_types f
    LEFT JOIN member_balances mb ON mb.fund_type_id = f.id
    GROUP BY f.id
  `).all();

  const memberBalances = await db.prepare(`
    SELECT m.first_name, m.last_name, m.member_number,
      SUM(CASE WHEN mb.fund_type_id = 1 THEN mb.balance ELSE 0 END) as welfare,
      SUM(CASE WHEN mb.fund_type_id = 2 THEN mb.balance ELSE 0 END) as savings,
      SUM(CASE WHEN mb.fund_type_id = 3 THEN mb.balance ELSE 0 END) as loan_fund,
      SUM(CASE WHEN mb.fund_type_id = 4 THEN mb.balance ELSE 0 END) as development,
      SUM(mb.balance) as total
    FROM members m
    JOIN member_balances mb ON mb.member_id = m.id
    GROUP BY m.id
    ORDER BY m.member_number
  `).all();

  const cycleContributions = await db.prepare(`
    SELECT cy.id as cycle_id, cy.start_date, cy.end_date,
      COUNT(DISTINCT c.member_id) as contributing_members,
      COALESCE(SUM(c.amount), 0) as total_contributions
    FROM cycles cy
    LEFT JOIN contributions c ON c.cycle_id = cy.id AND c.status = 'approved'
    GROUP BY cy.id
    ORDER BY cy.start_date DESC
  `).all();

  res.renderWithLayout('admin/reports', { fundBalances, memberBalances, cycleContributions });
});

router.get('/members/:id/contributions', async (req, res) => {
  const member = await db.prepare("SELECT * FROM members WHERE id = ?").get(req.params.id);
  if (!member) return res.redirect('/admin/members');

  const contributions = await db.prepare(`
    SELECT c.amount, c.status, c.created_at, f.name as fund, cy.start_date, cy.end_date
    FROM contributions c
    JOIN fund_types f ON c.fund_type_id = f.id
    JOIN cycles cy ON c.cycle_id = cy.id
    WHERE c.member_id = ?
    ORDER BY cy.start_date DESC, f.id
  `).all(req.params.id);

  const funds = await db.prepare("SELECT * FROM fund_types").all();
  const cycles = await db.prepare("SELECT * FROM cycles ORDER BY start_date DESC").all();

  const cycleData = {};
  contributions.forEach(c => {
    const key = c.start_date + '|' + c.end_date;
    if (!cycleData[key]) cycleData[key] = { start_date: c.start_date, end_date: c.end_date, funds: {} };
    cycleData[key].funds[c.fund] = { amount: c.amount, status: c.status, created_at: c.created_at };
  });

  res.renderWithLayout('admin/member_contributions', { member, cycleData, funds, contributions });
});

router.get('/payments', async (req, res) => {
  const requests = await db.prepare(`
    SELECT pr.*, m.first_name, m.last_name, m.member_number,
      CASE
        WHEN pr.payment_type = 'fine' THEN (SELECT reason FROM fines WHERE id = pr.reference_id)
        WHEN pr.payment_type = 'loan' THEN 'Loan Repayment'
        ELSE 'Member Card Repayment'
      END as description
    FROM payment_requests pr
    JOIN members m ON pr.member_id = m.id
    ORDER BY pr.created_at DESC
  `).all();
  res.renderWithLayout('admin/payments', { requests });
});

router.post('/payments/approve/:id', async (req, res) => {
  const reqData = await db.prepare("SELECT * FROM payment_requests WHERE id = ? AND status = 'pending'").get(req.params.id);
  if (!reqData) return res.redirect('/admin/payments');

  await db.transaction(async () => {
    const now = new Date().toISOString();
    await db.prepare("UPDATE payment_requests SET status = 'approved', approved_at = ? WHERE id = ?").run(now, reqData.id);

    if (reqData.payment_type === 'fine') {
      if (reqData.reference_id) {
        const fine = await db.prepare("SELECT * FROM fines WHERE id = ? AND status = 'pending'").get(reqData.reference_id);
        if (fine) {
          const newBalance = fine.balance - reqData.amount;
          if (newBalance <= 0) {
            await db.prepare("UPDATE fines SET balance = 0, status = 'paid' WHERE id = ?").run(fine.id);
          } else {
            await db.prepare('UPDATE fines SET balance = ? WHERE id = ?').run(newBalance, fine.id);
          }
        }
      } else {
        const pendingFines = await db.prepare("SELECT * FROM fines WHERE member_id = ? AND status = 'pending' ORDER BY created_at ASC").all(reqData.member_id);
        let remaining = reqData.amount;
        for (const fine of pendingFines) {
          if (remaining <= 0) break;
          const pay = Math.min(remaining, fine.balance);
          const newBalance = fine.balance - pay;
          if (newBalance <= 0) {
            await db.prepare("UPDATE fines SET balance = 0, status = 'paid' WHERE id = ?").run(fine.id);
          } else {
            await db.prepare('UPDATE fines SET balance = ? WHERE id = ?').run(newBalance, fine.id);
          }
          remaining -= pay;
        }
      }
    } else if (reqData.payment_type === 'member_card') {
      await db.prepare('UPDATE member_cards SET paid_amount = paid_amount + ? WHERE member_id = ?').run(reqData.amount, reqData.member_id);
    } else if (reqData.payment_type === 'loan') {
      const loan = await db.prepare("SELECT * FROM loans WHERE id = ? AND status = 'active'").get(reqData.reference_id);
      if (loan) {
        const newPaid = loan.paid_amount + reqData.amount;
        const newDue = loan.amount_due - reqData.amount;
        if (newDue <= 0) {
          await db.prepare("UPDATE loans SET paid_amount = ?, amount_due = 0, status = 'paid' WHERE id = ?").run(newPaid, loan.id);
        } else {
          await db.prepare('UPDATE loans SET paid_amount = ?, amount_due = ? WHERE id = ?').run(newPaid, newDue, loan.id);
        }
      }
    }
  })();
  const label = { fine: 'Fine', member_card: 'Card', loan: 'Loan' }[reqData.payment_type] || 'Payment';
  auditLog(req.session.user, 'approve', 'payment_request', reqData.id, label + ' payment KES ' + reqData.amount);
  await notify(reqData.member_id, label + ' Payment Approved', 'KES ' + reqData.amount.toLocaleString() + ' ' + label.toLowerCase() + ' payment approved', 'success', '/member');
  res.redirect('/admin/payments');
});

router.post('/payments/reject/:id', async (req, res) => {
  const reqData = await db.prepare("SELECT * FROM payment_requests WHERE id = ? AND status = 'pending'").get(req.params.id);
  await db.prepare("UPDATE payment_requests SET status = 'rejected' WHERE id = ? AND status = 'pending'").run(req.params.id);
  if (reqData) {
    const label = { fine: 'Fine', member_card: 'Card', loan: 'Loan' }[reqData.payment_type] || 'Payment';
    auditLog(req.session.user, 'reject', 'payment_request', reqData.id, label + ' payment KES ' + reqData.amount + ' rejected');
    await notify(reqData.member_id, label + ' Payment Rejected', 'KES ' + reqData.amount.toLocaleString() + ' ' + label.toLowerCase() + ' payment was rejected', 'error', '/member');
  }
  res.redirect('/admin/payments');
});

router.get('/withdrawals', async (req, res) => {
  const requests = await db.prepare(`
    SELECT wr.*, m.first_name, m.last_name, m.member_number, f.name as fund_name
    FROM withdrawal_requests wr
    JOIN members m ON wr.member_id = m.id
    JOIN fund_types f ON wr.fund_type_id = f.id
    ORDER BY wr.created_at DESC
  `).all();
  res.renderWithLayout('admin/withdrawals', { requests });
});

router.post('/withdrawals/approve/:id', async (req, res) => {
  const wr = await db.prepare("SELECT * FROM withdrawal_requests WHERE id = ? AND status = 'pending'").get(req.params.id);
  if (!wr) return res.redirect('/admin/withdrawals');
  await db.transaction(async () => {
    await db.prepare("UPDATE withdrawal_requests SET status = 'approved', approved_at = datetime('now') WHERE id = ?").run(wr.id);
    await db.prepare("UPDATE member_balances SET balance = balance - ? WHERE member_id = ? AND fund_type_id = ?").run(wr.amount, wr.member_id, wr.fund_type_id);
  })();
  auditLog(req.session.user, 'approve', 'withdrawal', wr.id, 'KES ' + wr.amount + ' from fund ' + wr.fund_type_id);
  await notify(wr.member_id, 'Withdrawal Approved', 'KES ' + wr.amount.toLocaleString() + ' withdrawal approved', 'success', '/withdraw');
  res.redirect('/admin/withdrawals');
});

router.post('/withdrawals/reject/:id', async (req, res) => {
  const wr = await db.prepare("SELECT * FROM withdrawal_requests WHERE id = ? AND status = 'pending'").get(req.params.id);
  await db.prepare("UPDATE withdrawal_requests SET status = 'rejected' WHERE id = ?").run(req.params.id);
  if (wr) { auditLog(req.session.user, 'reject', 'withdrawal', wr.id, 'KES ' + wr.amount + ' rejected');
    await notify(wr.member_id, 'Withdrawal Rejected', 'KES ' + wr.amount.toLocaleString() + ' withdrawal request was rejected', 'error', '/withdraw'); }
  res.redirect('/admin/withdrawals');
});

module.exports = router;
