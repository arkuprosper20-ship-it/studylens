const https = require('https');
const API_KEY = 'AIzaSyBvdq6jnAptb9LXY55GBrxc_heGJrRq6J4';

function request(url, method, body, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body) headers['Content-Type'] = 'application/json';
    const req = https.request(url, { method, headers }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch(e) { resolve({ status: res.statusCode, body: d.substring(0, 300) }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  try {
    // 1. Create test user
    const email = `verify-${Date.now()}@test.com`;
    const signUp = await request(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
      'POST', { email, password: 'testpass123', returnSecureToken: true }
    );
    console.log('1. Auth sign-up:', signUp.status, signUp.body.idToken ? 'token OK' : 'FAILED');
    if (!signUp.body.idToken) return;
    const token = signUp.body.idToken;
    const uid = signUp.body.localId;

    // 2. Try with (default) database name
    const ts = new Date().toISOString();
    const writeRes = await request(
      `https://firestore.googleapis.com/v1/projects/pawidhack/databases/(default)/documents/users?documentId=${uid}`,
      'POST', {
        fields: { name: { stringValue: 'Test User' }, email: { stringValue: email }, role: { stringValue: 'student' }, createdAt: { stringValue: ts }, updatedAt: { stringValue: ts } }
      }, token
    );
    console.log('2. Write to (default) DB:', writeRes.status, writeRes.body.name ? 'SUCCESS' : JSON.stringify(writeRes.body).substring(0, 200));

    if (writeRes.status === 404 && writeRes.body.error) {
      console.log('\n>>> The Firestore database (default) does NOT exist.');
      console.log('>>> Need to create it. Error:', writeRes.body.error.message.substring(0, 200));
    }

  } catch (e) {
    console.error('Error:', e.message);
  }
})();
