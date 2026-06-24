const db = require('./db');

// 1. Link chairman to Matich (member_id=11)
db.prepare('UPDATE users SET member_id = 11 WHERE username = ?').run('chairman');
console.log('Linked chairman -> Matich');

// 2. Link treasurer to Toby (member_id=17)
db.prepare('UPDATE users SET member_id = 17 WHERE username = ?').run('treasurer');
console.log('Linked treasurer -> Toby');

// 3. Delete matich/toby member user accounts
db.prepare('DELETE FROM users WHERE username IN (?, ?)').run('matich', 'toby');
console.log('Removed duplicate matich/toby member accounts');

// 4. Convert John Oloo -> welfare admin
db.prepare("UPDATE users SET role = 'admin', admin_role = 'welfare' WHERE username = ?").run('john');
console.log('John Oloo -> welfare admin');

// 5. Convert Mary Opondo -> secretary admin
db.prepare("UPDATE users SET role = 'admin', admin_role = 'secretary' WHERE username = ?").run('mary');
console.log('Mary Opondo -> secretary admin');

// Verify
const users = db.prepare('SELECT u.id, u.username, u.role, u.admin_role, u.member_id, m.first_name, m.last_name FROM users u LEFT JOIN members m ON u.member_id = m.id').all();
console.log('\nUpdated users:');
users.forEach(u => console.log('  ' + u.username + ' role=' + u.role + ' admin_role=' + (u.admin_role || '-') + ' member=' + (u.first_name || '') + ' ' + (u.last_name || '')));
