// Writes to the database (upserts users, resets passwords/roles) — must
// never run against Neon/production.
require('./scripts/testDbSafety').assertSafeTestDb();

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || "radha_dev_secret_key";

async function runTests() {
  try {
    // 1. Create or Reset Users
    console.log("Setting up users...");
    const adminPass = await bcrypt.hash("password", 10);
    const ownerPass = await bcrypt.hash("password", 10);
    const customerPass = await bcrypt.hash("password", 10);

    const admin = await prisma.user.upsert({
      where: { email: 'admin_test@test.com' },
      update: { role: 'ADMIN', password: adminPass },
      create: { name: 'Admin', email: 'admin_test@test.com', password: adminPass, role: 'ADMIN' }
    });

    // The protected master admin is whoever ADMIN_EMAIL names (test DB only).
    const superAdminEmail = process.env.ADMIN_EMAIL || 'superadmin_test@test.com';
    const superAdmin = await prisma.user.upsert({
      where: { email: superAdminEmail },
      update: { role: 'ADMIN', password: adminPass },
      create: { name: 'Super Admin', email: superAdminEmail, password: adminPass, role: 'ADMIN' }
    });

    const owner = await prisma.user.upsert({
      where: { email: 'owner_test@test.com' },
      update: { role: 'OWNER', password: ownerPass },
      create: { name: 'Owner', email: 'owner_test@test.com', password: ownerPass, role: 'OWNER' }
    });

    const customer = await prisma.user.upsert({
      where: { email: 'customer_test@test.com' },
      update: { role: 'CUSTOMER', password: customerPass },
      create: { name: 'Customer', email: 'customer_test@test.com', password: customerPass, role: 'CUSTOMER' }
    });

    const adminToken = jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: "1h" });
    const superAdminToken = jwt.sign({ id: superAdmin.id, role: superAdmin.role }, JWT_SECRET, { expiresIn: "1h" });
    const ownerToken = jwt.sign({ id: owner.id, role: owner.role }, JWT_SECRET, { expiresIn: "1h" });
    const customerToken = jwt.sign({ id: customer.id, role: customer.role }, JWT_SECRET, { expiresIn: "1h" });

    // Helper to run requests
    const runReq = async (method, path, token, body = null) => {
      const res = await fetch(`http://localhost:5001${path}`, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    };

    console.log("\n--- Testing Admin Endpoints ---");
    // Admin creates an owner
    let res = await runReq('POST', '/users/create-owner', adminToken, {
      name: "New Owner", email: `new_owner_${Date.now()}@test.com`, password: "123"
    });
    console.log(`Admin create-owner: ${res.status} (Expected: 200)`);
    if(res.status !== 200) console.log(res.data);

    // Admin promotes a customer to owner
    res = await runReq('PUT', `/users/${customer.id}/role`, adminToken, { role: "OWNER" });
    console.log(`Admin promote customer: ${res.status} (Expected: 200)`);
    if(res.status !== 200) console.log(res.data);
    
    // Admin demotes owner back to customer
    res = await runReq('PUT', `/users/${customer.id}/role`, adminToken, { role: "CUSTOMER" });
    console.log(`Admin demotes owner: ${res.status} (Expected: 200)`);
    if(res.status !== 200) console.log(res.data);

    // Admin tries to demote themselves
    res = await runReq('PUT', `/users/${admin.id}/role`, adminToken, { role: "CUSTOMER" });
    console.log(`Admin self-demotion: ${res.status} (Expected: 403)`);
    
    // Admin tries to demote superadmin
    res = await runReq('PUT', `/users/${superAdmin.id}/role`, adminToken, { role: "CUSTOMER" });
    console.log(`Admin demote superadmin: ${res.status} (Expected: 403)`);

    // Admin toggles promotion status
    res = await runReq('PUT', '/users/promotion-status', adminToken, { enabled: false });
    console.log(`Admin toggle promotion: ${res.status} (Expected: 200)`);
    if(res.status !== 200) console.log(res.data);
    
    // Re-enable
    await runReq('PUT', '/users/promotion-status', adminToken, { enabled: true });

    // Admin lists customers
    res = await runReq('GET', '/users', adminToken);
    console.log(`Admin lists customers: ${res.status} (Expected: 200)`);
    if(res.status !== 200) console.log(res.data);

    console.log("\n--- Testing Owner Endpoints ---");
    // Owner tries to list customers
    res = await runReq('GET', '/users', ownerToken);
    console.log(`Owner lists customers: ${res.status} (Expected: 403)`);

    // Owner tries to promote (forbidden)
    res = await runReq('PUT', `/users/${customer.id}/role`, ownerToken, { role: "ADMIN" });
    console.log(`Owner changes role: ${res.status} (Expected: 403)`);
    
    // Owner tries to toggle status (forbidden)
    res = await runReq('PUT', '/users/promotion-status', ownerToken, { enabled: false });
    console.log(`Owner toggle promotion: ${res.status} (Expected: 403)`);

    // Owner creates a category
    res = await runReq('POST', '/categories', ownerToken, { name: `TestCategory_${Date.now()}` });
    console.log(`Owner creates category: ${res.status} (Expected: 200)`);
    if(res.status !== 200) console.log(res.data);
    
    // Owner lists orders (admin view)
    res = await runReq('GET', '/orders/admin/all', ownerToken);
    console.log(`Owner lists orders: ${res.status} (Expected: 200)`);
    if(res.status !== 200) console.log(res.data);

    console.log("\n--- Testing Customer Endpoints ---");
    // Customer tries to list customers
    res = await runReq('GET', '/users', customerToken);
    console.log(`Customer lists customers: ${res.status} (Expected: 403)`);

    // Customer creates a category
    res = await runReq('POST', '/categories', customerToken, { name: `ShouldFail_${Date.now()}` });
    console.log(`Customer creates category: ${res.status} (Expected: 403)`);

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
