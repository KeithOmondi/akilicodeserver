import bcrypt from 'bcrypt';
import pool from './config/db';

const seedAdmin = async () => {
  const client = await pool.connect();
  try {
    console.log('--- 🌱 Starting Seeding Process ---');

    // 1. Define Admin Details
    const adminName = 'Dennis Keith';
    const adminEmail = 'kd.omondi1@gmail.com';
    const adminPhone = '+254 705806889';
    const adminPassword = 'Welcome@2026'; // Change this immediately!

    // 2. Check if Admin already exists
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    
    if (existing.rows.length > 0) {
      console.log('⚠️  Admin user already exists. Skipping...');
      return;
    }

    // 3. Hash Password
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    // 4. Insert Admin
    await client.query(
      `INSERT INTO users (name, email, phone, password, role) 
       VALUES ($1, $2, $3, $4, $5)`,
      [adminName, adminEmail, adminPhone, hashedPassword, 'admin']
    );

    console.log('✅ Admin user created successfully!');
    console.log(`📧 Email: ${adminEmail}`);
    console.log(`🔑 Password: ${adminPassword}`);
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    client.release();
    process.exit();
  }
};

seedAdmin();