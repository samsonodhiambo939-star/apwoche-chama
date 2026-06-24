const db = require('./db');
const bcrypt = require('bcryptjs');

const isPg = !!process.env.DATABASE_URL;

async function initDatabase() {
  if (isPg) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS members (id SERIAL PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT, member_number TEXT UNIQUE NOT NULL, is_active INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')), admin_role TEXT CHECK(admin_role IN ('chairman', 'treasurer', 'secretary', 'welfare')), member_id INTEGER REFERENCES members(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS fund_types (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT);
      CREATE TABLE IF NOT EXISTS cycles (id SERIAL PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT NOT NULL, is_open INTEGER DEFAULT 1, is_processed INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS contributions (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, fund_type_id INTEGER NOT NULL REFERENCES fund_types(id), cycle_id INTEGER NOT NULL REFERENCES cycles(id), amount REAL NOT NULL DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), UNIQUE(member_id, fund_type_id, cycle_id));
      CREATE TABLE IF NOT EXISTS member_balances (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, fund_type_id INTEGER NOT NULL REFERENCES fund_types(id), balance REAL NOT NULL DEFAULT 0, UNIQUE(member_id, fund_type_id));
      CREATE TABLE IF NOT EXISTS loans (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, amount REAL NOT NULL, interest_rate REAL DEFAULT 10, amount_due REAL NOT NULL, issued_date TEXT, due_date TEXT, approved_date TEXT, status TEXT DEFAULT 'pending', paid_amount REAL DEFAULT 0, defaulted_penalty REAL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS fines (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, amount REAL NOT NULL, balance REAL NOT NULL, reason TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS member_cards (id SERIAL PRIMARY KEY, member_id INTEGER UNIQUE NOT NULL REFERENCES members(id) ON DELETE CASCADE, assigned_amount REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS payment_requests (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, payment_type TEXT NOT NULL CHECK(payment_type IN ('fine', 'member_card', 'loan')), reference_id INTEGER, amount REAL NOT NULL, status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), created_at TIMESTAMP DEFAULT NOW(), approved_at TIMESTAMP);
      CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, member_id INTEGER REFERENCES members(id) ON DELETE CASCADE, user_id INTEGER, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'info', is_read INTEGER DEFAULT 0, link TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS withdrawal_requests (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, fund_type_id INTEGER NOT NULL REFERENCES fund_types(id), amount REAL NOT NULL, status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), created_at TIMESTAMP DEFAULT NOW(), approved_at TIMESTAMP);
      CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, user_id INTEGER, username TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER, details TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS welfare_requests (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, amount REAL NOT NULL, reason TEXT NOT NULL, beneficiary_name TEXT NOT NULL, beneficiary_id_number TEXT NOT NULL, relationship TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), reviewed_by INTEGER REFERENCES users(id), review_notes TEXT, created_at TIMESTAMP DEFAULT NOW(), reviewed_at TIMESTAMP);
      CREATE TABLE IF NOT EXISTS meeting_minutes (id SERIAL PRIMARY KEY, title TEXT NOT NULL, meeting_date TEXT NOT NULL, content TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS welfare_registrations (id SERIAL PRIMARY KEY, member_id INTEGER UNIQUE NOT NULL REFERENCES members(id) ON DELETE CASCADE, status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'locked')), locked INTEGER DEFAULT 0, edit_requested INTEGER DEFAULT 0, form_data TEXT, submitted_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS idx_contributions_member_id ON contributions(member_id);
      CREATE INDEX IF NOT EXISTS idx_contributions_status ON contributions(status);
      CREATE INDEX IF NOT EXISTS idx_loans_member_id ON loans(member_id);
      CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
      CREATE INDEX IF NOT EXISTS idx_member_balances_member_id ON member_balances(member_id);
      CREATE INDEX IF NOT EXISTS idx_fines_member_id ON fines(member_id);
      CREATE INDEX IF NOT EXISTS idx_payment_requests_member_id ON payment_requests(member_id);
      CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
      CREATE INDEX IF NOT EXISTS idx_notifications_member_id ON notifications(member_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_member_id ON withdrawal_requests(member_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status);
      CREATE INDEX IF NOT EXISTS idx_welfare_requests_member_id ON welfare_requests(member_id);
      CREATE INDEX IF NOT EXISTS idx_welfare_requests_status ON welfare_requests(status);
      CREATE INDEX IF NOT EXISTS idx_meeting_minutes_created_by ON meeting_minutes(created_by);
    `);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT, member_number TEXT UNIQUE NOT NULL, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')), admin_role TEXT CHECK(admin_role IN ('chairman', 'treasurer', 'secretary', 'welfare')), member_id INTEGER, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS fund_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT);
      CREATE TABLE IF NOT EXISTS cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, start_date TEXT NOT NULL, end_date TEXT NOT NULL, is_open INTEGER DEFAULT 1, is_processed INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS contributions (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, fund_type_id INTEGER NOT NULL, cycle_id INTEGER NOT NULL, amount REAL NOT NULL DEFAULT 0, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), UNIQUE(member_id, fund_type_id, cycle_id), FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE, FOREIGN KEY (fund_type_id) REFERENCES fund_types(id), FOREIGN KEY (cycle_id) REFERENCES cycles(id));
      CREATE TABLE IF NOT EXISTS member_balances (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, fund_type_id INTEGER NOT NULL, balance REAL NOT NULL DEFAULT 0, UNIQUE(member_id, fund_type_id), FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE, FOREIGN KEY (fund_type_id) REFERENCES fund_types(id));
      CREATE TABLE IF NOT EXISTS loans (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, amount REAL NOT NULL, interest_rate REAL DEFAULT 10, amount_due REAL NOT NULL, issued_date TEXT, due_date TEXT, approved_date TEXT, status TEXT DEFAULT 'pending', paid_amount REAL DEFAULT 0, defaulted_penalty REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS fines (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, amount REAL NOT NULL, balance REAL NOT NULL, reason TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS member_cards (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER UNIQUE NOT NULL, assigned_amount REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS payment_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, payment_type TEXT NOT NULL CHECK(payment_type IN ('fine', 'member_card', 'loan')), reference_id INTEGER, amount REAL NOT NULL, status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), created_at TEXT DEFAULT (datetime('now')), approved_at TEXT, FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER, user_id INTEGER, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'info', is_read INTEGER DEFAULT 0, link TEXT, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS withdrawal_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, fund_type_id INTEGER NOT NULL, amount REAL NOT NULL, status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), created_at TEXT DEFAULT (datetime('now')), approved_at TEXT, FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER, details TEXT, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS welfare_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, amount REAL NOT NULL, reason TEXT NOT NULL, beneficiary_name TEXT NOT NULL, beneficiary_id_number TEXT NOT NULL, relationship TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), reviewed_by INTEGER, review_notes TEXT, created_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT, FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE, FOREIGN KEY (reviewed_by) REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS meeting_minutes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, meeting_date TEXT NOT NULL, content TEXT NOT NULL, created_by INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (created_by) REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS welfare_registrations (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL UNIQUE, status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'locked')), locked INTEGER DEFAULT 0, edit_requested INTEGER DEFAULT 0, form_data TEXT, submitted_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS idx_contributions_member_id ON contributions(member_id);
      CREATE INDEX IF NOT EXISTS idx_contributions_status ON contributions(status);
      CREATE INDEX IF NOT EXISTS idx_loans_member_id ON loans(member_id);
      CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
      CREATE INDEX IF NOT EXISTS idx_member_balances_member_id ON member_balances(member_id);
      CREATE INDEX IF NOT EXISTS idx_fines_member_id ON fines(member_id);
      CREATE INDEX IF NOT EXISTS idx_payment_requests_member_id ON payment_requests(member_id);
      CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
      CREATE INDEX IF NOT EXISTS idx_notifications_member_id ON notifications(member_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_member_id ON withdrawal_requests(member_id);
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status);
      CREATE INDEX IF NOT EXISTS idx_welfare_requests_member_id ON welfare_requests(member_id);
      CREATE INDEX IF NOT EXISTS idx_welfare_requests_status ON welfare_requests(status);
      CREATE INDEX IF NOT EXISTS idx_meeting_minutes_created_by ON meeting_minutes(created_by);
    `);
    try { db.prepare("ALTER TABLE users ADD COLUMN admin_role TEXT CHECK(admin_role IN ('chairman', 'treasurer', 'secretary', 'welfare'))").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE contributions ADD COLUMN status TEXT DEFAULT 'pending'").run(); } catch(e) {}
  }

  const fundCount = isPg ? await db.prepare('SELECT COUNT(*) as count FROM fund_types').get() : db.prepare('SELECT COUNT(*) as count FROM fund_types').get();
  if (fundCount.count === 0) {
    if (isPg) {
      await db.prepare("INSERT INTO fund_types (name, description) VALUES ('Welfare', 'Emergency and welfare support fund')").run();
      await db.prepare("INSERT INTO fund_types (name, description) VALUES ('Savings', 'General savings account')").run();
      await db.prepare("INSERT INTO fund_types (name, description) VALUES ('Loans', 'Loan fund pool')").run();
      await db.prepare("INSERT INTO fund_types (name, description) VALUES ('Development', 'Development and investment fund')").run();
    } else {
      const insertFund = db.prepare('INSERT INTO fund_types (name, description) VALUES (?, ?)');
      insertFund.run('Welfare', 'Emergency and welfare support fund');
      insertFund.run('Savings', 'General savings account');
      insertFund.run('Loans', 'Loan fund pool');
      insertFund.run('Development', 'Development and investment fund');
    }
  }

  const adminUser = isPg ? await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() : db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
  if (adminUser.count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    if (isPg) {
      await db.prepare("INSERT INTO users (username, password_hash, role, admin_role) VALUES ($1, $2, 'admin', 'chairman')").run('chairman', hash);
      await db.prepare("INSERT INTO users (username, password_hash, role, admin_role) VALUES ($1, $2, 'admin', 'treasurer')").run('treasurer', hash);
      await db.prepare("INSERT INTO users (username, password_hash, role, admin_role) VALUES ($1, $2, 'admin', 'secretary')").run('secretary', hash);
      await db.prepare("INSERT INTO users (username, password_hash, role, admin_role) VALUES ($1, $2, 'admin', 'welfare')").run('welfare', hash);
    } else {
      db.prepare("INSERT INTO users (username, password_hash, role, admin_role) VALUES (?, ?, 'admin', 'chairman')").run('chairman', hash);
      db.prepare("INSERT INTO users (username, password_hash, role, admin_role) VALUES (?, ?, 'admin', 'treasurer')").run('treasurer', hash);
      db.prepare("INSERT INTO users (username, password_hash, role, admin_role) VALUES (?, ?, 'admin', 'secretary')").run('secretary', hash);
      db.prepare("INSERT INTO users (username, password_hash, role, admin_role) VALUES (?, ?, 'admin', 'welfare')").run('welfare', hash);
    }
  }
}

async function seedMembers() {
  const memberCount = isPg ? await db.prepare('SELECT COUNT(*) as count FROM members').get() : db.prepare('SELECT COUNT(*) as count FROM members').get();
  if (memberCount.count > 0) return;

  const names = [
    'James Kamau', 'Grace Wanjiku', 'Peter Ochieng', 'Faith Akinyi', 'Samuel Mwangi',
    'Diana Wambui', 'Kevin Kiprop', 'Nancy Chebet', 'Brian Otieno', 'Esther Wairimu',
    'David Mutua', 'Caroline Nyambura', 'Joseph Kiplagat', 'Ruth Jerono', 'Daniel Muthama',
    'Sarah Wanjala', 'Patrick Mboya', 'Agnes Wanjiru', 'Thomas Njoroge', 'Jane Atieno',
    'Michael Omondi', 'Catherine Wamaitha', 'Simon Kipngeno', 'Margaret Wacera', 'John Barasa'
  ];

  if (isPg) {
    for (let i = 0; i < names.length; i++) {
      const [first, last] = names[i].split(' ');
      const num = `MEM${String(i + 1).padStart(3, '0')}`;
      const result = await db.prepare("INSERT INTO members (first_name, last_name, member_number) VALUES ($1, $2, $3)").run(first, last, num);
      const memberId = result.lastInsertRowid;
      const hash = bcrypt.hashSync('member123', 10);
      await db.prepare("INSERT INTO users (username, password_hash, role, member_id) VALUES ($1, $2, 'member', $3)").run(`member${i + 1}`, hash, memberId);
      for (let f = 1; f <= 4; f++) {
        await db.prepare("INSERT INTO member_balances (member_id, fund_type_id, balance) VALUES ($1, $2, 0)").run(memberId, f);
      }
    }
  } else {
    const insertMember = db.prepare('INSERT INTO members (first_name, last_name, member_number) VALUES (?, ?, ?)');
    const insertUser = db.prepare('INSERT INTO users (username, password_hash, role, member_id) VALUES (?, ?, ?, ?)');
    const insertBalance = db.prepare('INSERT INTO member_balances (member_id, fund_type_id, balance) VALUES (?, ?, 0)');
    const insertAll = db.transaction(() => {
      names.forEach((name, i) => {
        const [first, last] = name.split(' ');
        const num = `MEM${String(i + 1).padStart(3, '0')}`;
        const result = insertMember.run(first, last, num);
        const memberId = result.lastInsertRowid;
        const hash = bcrypt.hashSync('member123', 10);
        insertUser.run(`member${i + 1}`, hash, 'member', memberId);
        for (let f = 1; f <= 4; f++) insertBalance.run(memberId, f);
      });
    });
    insertAll();
  }
}

module.exports = { initDatabase, seedMembers };