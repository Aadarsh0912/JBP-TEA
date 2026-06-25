require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("FATAL: MONGODB_URI environment variable is not set. Create a .env file or set it in your hosting platform.");
  process.exit(1);
}
const client = new MongoClient(uri);

async function connectDB() {
  try {
    await client.connect();
    console.log("Connected successfully to MongoDB");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}
connectDB();

// Use PORT from env (Railway, Render, Heroku inject this) or fallback to 3000
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// File extensions that benefit from long cache times
const CACHEABLE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.mp4', '.webm', '.woff', '.woff2']);

const server = http.createServer(async (req, res) => {
  // ── Security headers (applied to every response) ──
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // ── CORS headers for API routes ──
  if (req.url.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // ── POST /api/orders ──
  if (req.method === 'POST' && req.url === '/api/orders') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Prevent excessively large payloads (1 MB limit)
      if (body.length > 1e6) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Payload too large' }));
        req.destroy();
      }
    });
    req.on('end', async () => {
      try {
        const order = JSON.parse(body);
        
        const db = client.db("jbp_tea");
        const ordersCollection = db.collection("orders");
        await ordersCollection.insertOne(order);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Order received successfully.' }));
      } catch (err) {
        console.error("Error saving order to MongoDB:", err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Failed to process order' }));
      }
    });
    return;
  }

  // ── GET /api/orders?phone=... ──
  if (req.method === 'GET' && req.url.startsWith('/api/orders')) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      const phone = urlObj.searchParams.get('phone');
      
      if (!phone) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Phone number is required' }));
        return;
      }
      
      const db = client.db("jbp_tea");
      const ordersCollection = db.collection("orders");
      const orders = await ordersCollection.find({ phone: phone }).sort({ createdAt: -1 }).toArray();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, orders: orders }));
    } catch (err) {
      console.error("Error fetching orders from MongoDB:", err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Failed to fetch orders' }));
    }
    return;
  }

  // ── Admin Auth Helper ──
  const crypto = require('crypto');
  function generateToken() {
    const secret = process.env.ADMIN_SECRET || 'fallback_secret';
    const password = process.env.ADMIN_PASSWORD || 'admin';
    return crypto.createHmac('sha256', secret).update(password).digest('hex');
  }
  function isAuthorized(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return false;
    return auth.split(' ')[1] === generateToken();
  }

  // ── POST /api/admin/login ──
  if (req.method === 'POST' && req.url === '/api/admin/login') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body);
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
        if (password === adminPassword) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, token: generateToken() }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid password' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
      }
    });
    return;
  }

  // ── GET /api/admin/orders ── (requires auth)
  if (req.method === 'GET' && req.url.startsWith('/api/admin/orders')) {
    if (!isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      return;
    }
    try {
      const db = client.db("jbp_tea");
      const orders = await db.collection("orders").find({}).sort({ createdAt: -1 }).toArray();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, orders }));
    } catch (err) {
      console.error("Error fetching admin orders:", err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Failed to fetch orders' }));
    }
    return;
  }

  // ── PATCH /api/admin/orders/:id ── (requires auth)
  const patchMatch = req.url.match(/^\/api\/admin\/orders\/([a-f0-9]{24})$/);
  if (req.method === 'PATCH' && patchMatch) {
    if (!isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      return;
    }
    const orderId = patchMatch[1];
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { status } = JSON.parse(body);
        const { ObjectId } = require('mongodb');
        const db = client.db("jbp_tea");
        await db.collection("orders").updateOne(
          { _id: new ObjectId(orderId) },
          { $set: { status: status, updatedAt: new Date().toISOString() } }
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error("Error updating order:", err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Failed to update order' }));
      }
    });
    return;
  }

  // ── Static file serving ──
  let urlPath = req.url.split('?')[0].split('#')[0];
  let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);

  // Safety check: prevent path traversal
  const relative = path.relative(__dirname, filePath);
  const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  
  if (urlPath !== '/' && isSafe === false) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  function serveFile(fileToServe, contentTypeToServe) {
    const range = req.headers.range;
    if (range && (contentTypeToServe === 'video/mp4' || contentTypeToServe === 'video/webm')) {
      fs.stat(fileToServe, (err, stats) => {
        if (err) {
          res.writeHead(500);
          res.end(`Server Error: ${err.code}`);
          return;
        }
        const fileSize = stats.size;
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`
          });
          res.end();
          return;
        }

        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(fileToServe, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentTypeToServe,
        };
        res.writeHead(206, head);
        fileStream.pipe(res);
      });
    } else {
      fs.readFile(fileToServe, (error, content) => {
        if (error) {
          res.writeHead(500);
          res.end(`Server Error: ${error.code}`);
        } else {
          // Cache static assets for 7 days; HTML for 1 hour
          const ext = path.extname(fileToServe).toLowerCase();
          if (CACHEABLE_EXTENSIONS.has(ext)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
          } else if (ext === '.css' || ext === '.js') {
            res.setHeader('Cache-Control', 'public, max-age=86400');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
          res.writeHead(200, { 'Content-Type': contentTypeToServe });
          res.end(content);
        }
      });
    }
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      if (!path.extname(filePath)) {
        const fallbackPath = filePath + '.html';
        fs.stat(fallbackPath, (fallbackError, fallbackStats) => {
          if (!fallbackError && fallbackStats.isFile()) {
            serveFile(fallbackPath, 'text/html');
          } else {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 Not Found</h1>', 'utf-8');
          }
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      }
    } else {
      serveFile(filePath, contentType);
    }
  });
});

// ── Start server — bind 0.0.0.0 for container hosts (Render, Railway, etc.) ──
if (!process.env.VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}/`);
  }).on('error', (err) => {
    console.error("Server failed to start:", err);
    process.exit(1);
  });
}

// Export for Vercel Serverless Functions
module.exports = (req, res) => {
  server.emit('request', req, res);
};

// ── Graceful shutdown ──
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(async () => {
    await client.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down...');
  server.close(async () => {
    await client.close();
    process.exit(0);
  });
});
