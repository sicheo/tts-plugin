const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const axios = require('axios');


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configurazione multer per upload file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.py', '.txt','.json'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Solo file .py .json e .txt sono permessi'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// Database in memoria per tracciare le sessioni OTA
const otaSessions = new Map();

// Route principale - serve l'applicazione React
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: Upload e processamento file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }

    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath);
    const chunkSize = parseInt(req.body.chunkSize) || 50;

    // Calcola hash SHA-256
    const hash = crypto.createHash('sha256').update(fileContent).digest('hex');

    // Dividi in chunks
    const chunks = [];
    for (let i = 0; i < fileContent.length; i += chunkSize) {
      chunks.push(fileContent.slice(i, i + chunkSize));
    }

    const fileInfo = {
      name: req.file.originalname,
      size: fileContent.length,
      hash: hash,
      totalChunks: chunks.length,
      chunkSize: chunkSize,
      uploadedAt: new Date().toISOString(),
      filePath: filePath
    };

    // Salva informazioni nella sessione
    const sessionId = `session-${Date.now()}`;
    otaSessions.set(sessionId, {
      ...fileInfo,
      chunks: chunks,
      status: 'ready'
    });

    res.json({
      success: true,
      sessionId: sessionId,
      fileInfo: fileInfo
    });

  } catch (error) {
    console.error('Errore upload:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Invio downlink a TTN
app.post('/api/downlink', async (req, res) => {
  try {
    const { serverUrl, appId, apiKey, deviceId, port, payload, confirmed } = req.body;

    if (!serverUrl || !appId || !apiKey || !deviceId || !payload) {
      return res.status(400).json({ error: 'Parametri mancanti' });
    }

    const url = `${serverUrl}/api/v3/as/applications/${appId}/devices/${deviceId}/down/push`;

    // Converti payload da array di byte a hex string
    const payloadHex = Buffer.from(payload).toString('hex');
    const payloadBase64 = Buffer.from(payload).toString('base64');


    const data = {
      downlinks: [{
        f_port: port || 200,
        frm_payload: payloadBase64,
        priority: confirmed ? 'HIGHEST' : 'NORMAL',
        confirmed: confirmed || false
      }]
    };

    const response = await axios.post(url, data, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.json({
      success: true,
      message: 'Downlink inviato con successo',
      data: response.data
    });

  } catch (error) {
    console.error('Errore invio downlink:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message
    });
  }
});

// API: Avvia aggiornamento OTA
app.post('/api/ota/start', async (req, res) => {
  try {
    const { sessionId, serverUrl, appId, apiKey, deviceId } = req.body;

    const session = otaSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Sessione non trovata' });
    }

    // Costruisci payload START
    const hashBytes = Buffer.from(session.hash, 'hex');
    const payload = Buffer.alloc(35);
    payload[0] = 0x01; // CMD: START_UPDATE
    payload.writeUInt16BE(session.totalChunks, 1);
    hashBytes.copy(payload, 3);

    // Invia downlink
    const url = `${serverUrl}/api/v3/as/applications/${appId}/devices/${deviceId}/down/push`;
    const payloadHex = payload.toString('hex');
    const payloadBase64 = payload.toString('base64');  // USARE BASE64!

    const data = {
      downlinks: [{
        f_port: 200,
        frm_payload: payloadBase64,
        priority: 'HIGHEST',
        confirmed: true
      }]
    };

    await axios.post(url, data, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    session.status = 'started';
    session.deviceId = deviceId;
    session.startedAt = new Date().toISOString();

    res.json({
      success: true,
      message: 'Comando START inviato',
      session: {
        sessionId: sessionId,
        totalChunks: session.totalChunks,
        hash: session.hash
      }
    });

  } catch (error) {
    console.error('Errore avvio OTA:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: Invia chunks
app.post('/api/ota/send-chunks', async (req, res) => {
  try {
    const { sessionId, serverUrl, appId, apiKey, deviceId, delay } = req.body;

    const session = otaSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Sessione non trovata' });
    }

    const url = `${serverUrl}/api/v3/as/applications/${appId}/devices/${deviceId}/down/push`;
    const chunkDelay = delay || 2000;

    // Invia chunks in modo asincrono
    res.json({
      success: true,
      message: 'Invio chunks avviato',
      totalChunks: session.totalChunks
    });

    // Processo asincrono per inviare i chunks
    (async () => {
      for (let i = 0; i < session.chunks.length; i++) {
        const chunk = session.chunks[i];
        const payload = Buffer.alloc(3 + chunk.length);
        payload[0] = 0x02; // CMD: CHUNK_DATA
        payload.writeUInt16BE(i, 1);
        chunk.copy(payload, 3);

        const payloadHex = payload.toString('hex');
        const payloadBase64 = payload.toString('base64');  // USARE BASE64!


        const data = {
          downlinks: [{
            f_port: 200,
            frm_payload: payloadBase64,
            priority: 'NORMAL',
            confirmed: false
          }]
        };

        try {
          await axios.post(url, data, {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            }
          });

          console.log(`Chunk ${i + 1}/${session.totalChunks} inviato`);
          
          // Delay tra chunks
          if (i < session.chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, chunkDelay));
          }

        } catch (error) {
          console.error(`Errore invio chunk ${i}:`, error.message);
        }
      }

      session.status = 'completed';
      session.completedAt = new Date().toISOString();
      console.log('Tutti i chunks sono stati inviati');
    })();

  } catch (error) {
    console.error('Errore invio chunks:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: Richiedi stato
app.post('/api/ota/status', async (req, res) => {
  try {
    const { serverUrl, appId, apiKey, deviceId } = req.body;

    const payload = Buffer.from([0x03]); // CMD: REQUEST_STATUS
    const payloadHex = payload.toString('hex');
    const payloadBase64 = payload.toString('base64');  // USARE BASE64!

    const url = `${serverUrl}/api/v3/as/applications/${appId}/devices/${deviceId}/down/push`;

    const data = {
      downlinks: [{
        f_port: 200,
        frm_payload: payloadBase64,
        priority: 'HIGHEST',
        confirmed: true
      }]
    };

    await axios.post(url, data, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    res.json({
      success: true,
      message: 'Richiesta stato inviata'
    });

  } catch (error) {
    console.error('Errore richiesta stato:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: Annulla aggiornamento
app.post('/api/ota/abort', async (req, res) => {
  try {
    const { sessionId, serverUrl, appId, apiKey, deviceId } = req.body;

    const payload = Buffer.from([0x04]); // CMD: ABORT_UPDATE
    const payloadHex = payload.toString('hex');
    const payloadBase64 = payload.toString('base64');  // USARE BASE64!


    const url = `${serverUrl}/api/v3/as/applications/${appId}/devices/${deviceId}/down/push`;

    const data = {
      downlinks: [{
        f_port: 200,
        frm_payload: payloadBase64,
        priority: 'HIGHEST',
        confirmed: true
      }]
    };

    await axios.post(url, data, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (sessionId) {
      const session = otaSessions.get(sessionId);
      if (session) {
        session.status = 'aborted';
      }
    }

    res.json({
      success: true,
      message: 'Comando ABORT inviato'
    });

  } catch (error) {
    console.error('Errore annullamento:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: Lista sessioni OTA
app.get('/api/sessions', (req, res) => {
  const sessions = Array.from(otaSessions.entries()).map(([id, session]) => ({
    sessionId: id,
    name: session.name,
    size: session.size,
    totalChunks: session.totalChunks,
    status: session.status,
    uploadedAt: session.uploadedAt,
    startedAt: session.startedAt,
    completedAt: session.completedAt
  }));

  res.json({ sessions });
});

// API: Elimina sessione
app.delete('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  const session = otaSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Sessione non trovata' });
  }

  // Elimina file
  try {
    if (fs.existsSync(session.filePath)) {
      fs.unlinkSync(session.filePath);
    }
  } catch (error) {
    console.error('Errore eliminazione file:', error);
  }

  otaSessions.delete(sessionId);

  res.json({
    success: true,
    message: 'Sessione eliminata'
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeSessions: otaSessions.size
  });
});

// Gestione errori
app.use((err, req, res, next) => {
  console.error('Errore server:', err);
  res.status(500).json({
    error: 'Errore interno del server',
    message: err.message
  });
});

// Avvio server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║   TTN LoRaWAN OTA Manager Server                  ║
╠════════════════════════════════════════════════════╣
║   Server attivo su: http://localhost:${PORT}       ║
║                                                    ║
║   Endpoints disponibili:                          ║
║   - GET  /                    (Web App)           ║
║   - POST /api/upload          (Upload file)       ║
║   - POST /api/downlink        (Invia downlink)    ║
║   - POST /api/ota/start       (Avvia OTA)         ║
║   - POST /api/ota/send-chunks (Invia chunks)      ║
║   - POST /api/ota/status      (Richiedi stato)    ║
║   - POST /api/ota/abort       (Annulla OTA)       ║
║   - GET  /api/sessions        (Lista sessioni)    ║
║   - GET  /api/health          (Health check)      ║
╚════════════════════════════════════════════════════╝
  `);
});

// Gestione chiusura graceful
process.on('SIGTERM', () => {
  console.log('SIGTERM ricevuto, chiusura server...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT ricevuto, chiusura server...');
  process.exit(0);
});