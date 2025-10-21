import React, { useState } from 'react';
import { Upload, Send, RefreshCw, AlertCircle, CheckCircle, Settings, Wifi } from 'lucide-react';

export default function TTNOTAManager() {
  const [config, setConfig] = useState({
    serverUrl: 'https://eu1.cloud.thethings.network',
    appId: '',
    apiKey: '',
    deviceId: '',
    chunkSize: 50
  });

  const [file, setFile] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [showConfig, setShowConfig] = useState(true);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      addLog(`File selezionato: ${selectedFile.name} (${selectedFile.size} bytes)`, 'success');
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        const content = event.target.result;
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        const chunks = [];
        for (let i = 0; i < data.length; i += config.chunkSize) {
          chunks.push(data.slice(i, i + config.chunkSize));
        }
        
        setFileInfo({
          name: selectedFile.name,
          size: data.length,
          hash: hashHex,
          chunks: chunks,
          totalChunks: chunks.length,
          data: data
        });
        
        addLog(`File processato: ${chunks.length} chunks, hash: ${hashHex.substring(0, 16)}...`, 'info');
      };
      reader.readAsText(selectedFile);
    }
  };

  const sendDownlink = async (port, payload, confirmed = false) => {
    const url = `${config.serverUrl}/api/v3/as/applications/${config.appId}/devices/${config.deviceId}/down/push`;
    
    const payloadHex = Array.from(payload)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    const data = {
      downlinks: [{
        f_port: port,
        frm_payload: payloadHex,
        priority: confirmed ? 'HIGHEST' : 'NORMAL',
        confirmed: confirmed
      }]
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        addLog(`Downlink inviato: porta ${port}, ${payload.length} bytes`, 'success');
        return true;
      } else {
        const error = await response.text();
        addLog(`Errore invio downlink: ${response.status} - ${error}`, 'error');
        return false;
      }
    } catch (error) {
      addLog(`Errore di rete: ${error.message}`, 'error');
      return false;
    }
  };

  const startUpdate = async () => {
    if (!fileInfo) {
      addLog('Nessun file selezionato', 'error');
      return;
    }

    setStatus('starting');
    addLog('=== AVVIO AGGIORNAMENTO OTA ===', 'info');
    addLog(`Device: ${config.deviceId}`, 'info');
    addLog(`File: ${fileInfo.name} (${fileInfo.size} bytes)`, 'info');
    addLog(`Chunks totali: ${fileInfo.totalChunks}`, 'info');

    const hashBytes = new Uint8Array(
      fileInfo.hash.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
    );

    const payload = new Uint8Array(35);
    payload[0] = 0x01;
    payload[1] = (fileInfo.totalChunks >> 8) & 0xFF;
    payload[2] = fileInfo.totalChunks & 0xFF;
    payload.set(hashBytes, 3);

    const success = await sendDownlink(200, payload, true);
    
    if (success) {
      setStatus('ready');
      addLog('Comando START inviato. Il device deve inviare un uplink per riceverlo.', 'info');
      addLog('Premi "Invia Chunks" quando il device ha confermato la ricezione.', 'info');
    } else {
      setStatus('error');
      addLog('Errore durante l\'invio del comando START', 'error');
    }
  };

  const sendChunks = async () => {
    if (!fileInfo || status !== 'ready') {
      return;
    }

    setStatus('sending');
    setProgress(0);
    addLog('=== INVIO CHUNKS ===', 'info');

    for (let i = 0; i < fileInfo.chunks.length; i++) {
      const chunk = fileInfo.chunks[i];
      const payload = new Uint8Array(3 + chunk.length);
      payload[0] = 0x02;
      payload[1] = (i >> 8) & 0xFF;
      payload[2] = i & 0xFF;
      payload.set(chunk, 3);

      const success = await sendDownlink(200, payload);
      
      if (!success) {
        setStatus('error');
        addLog(`Errore durante l'invio del chunk ${i}`, 'error');
        return;
      }

      const progressPercent = Math.round(((i + 1) / fileInfo.totalChunks) * 100);
      setProgress(progressPercent);
      addLog(`Chunk ${i + 1}/${fileInfo.totalChunks} accodato (${chunk.length} bytes)`, 'success');

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    setStatus('completed');
    addLog('=== TUTTI I CHUNKS ACCODATI ===', 'success');
    addLog('I chunks verranno inviati quando il device invia uplink.', 'info');
    addLog('Monitora il device per verificare il completamento.', 'info');
  };

  const requestStatus = async () => {
    const payload = new Uint8Array([0x03]);
    await sendDownlink(200, payload, true);
    addLog('Richiesta stato inviata', 'info');
  };

  const abortUpdate = async () => {
    const payload = new Uint8Array([0x04]);
    await sendDownlink(200, payload, true);
    setStatus('idle');
    setProgress(0);
    addLog('Comando ABORT inviato', 'error');
  };

  const resetAll = () => {
    setFile(null);
    setFileInfo(null);
    setStatus('idle');
    setProgress(0);
    setLogs([]);
    addLog('Applicazione resettata', 'info');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-slate-800 rounded-lg shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wifi className="w-8 h-8 text-white" />
                <h1 className="text-2xl font-bold text-white">TTN LoRaWAN OTA Manager</h1>
              </div>
              <button
                onClick={() => setShowConfig(!showConfig)}
                className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white transition-colors"
              >
                <Settings className="w-4 h-4" />
                Configurazione
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {showConfig && (
              <div className="bg-slate-700 rounded-lg p-6 space-y-4">
                <h2 className="text-xl font-semibold text-white mb-4">Configurazione Server TTN</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Server URL
                    </label>
                    <input
                      type="text"
                      value={config.serverUrl}
                      onChange={(e) => setConfig({...config, serverUrl: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="https://eu1.cloud.thethings.network"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Per server locale: http://localhost:1885 o http://192.168.x.x:1885
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Application ID
                    </label>
                    <input
                      type="text"
                      value={config.appId}
                      onChange={(e) => setConfig({...config, appId: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="my-application"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={config.apiKey}
                      onChange={(e) => setConfig({...config, apiKey: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="NNSXS.XXXXXX..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Device ID
                    </label>
                    <input
                      type="text"
                      value={config.deviceId}
                      onChange={(e) => setConfig({...config, deviceId: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="my-device-01"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Chunk Size (bytes)
                    </label>
                    <input
                      type="number"
                      value={config.chunkSize}
                      onChange={(e) => setConfig({...config, chunkSize: parseInt(e.target.value)})}
                      className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      min="20"
                      max="200"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      SF7: 200, SF8: 100, SF9: 50, SF10: 25
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-700 rounded-lg p-6">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Upload className="w-5 h-5" />
                  File Upload
                </h2>

                <div className="space-y-4">
                  <div className="border-2 border-dashed border-slate-500 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
                    <input
                      type="file"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="file-upload"
                      accept=".py,.txt"
                    />
                    <label
                      htmlFor="file-upload"
                      className="cursor-pointer flex flex-col items-center gap-2"
                    >
                      <Upload className="w-12 h-12 text-gray-400" />
                      <span className="text-gray-300">
                        {file ? file.name : 'Clicca per selezionare un file .py'}
                      </span>
                      {file && (
                        <span className="text-sm text-gray-400">
                          {(file.size / 1024).toFixed(2)} KB
                        </span>
                      )}
                    </label>
                  </div>

                  {fileInfo && (
                    <div className="bg-slate-600 rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex justify-between text-gray-300">
                        <span>Dimensione:</span>
                        <span className="font-mono">{fileInfo.size} bytes</span>
                      </div>
                      <div className="flex justify-between text-gray-300">
                        <span>Chunks:</span>
                        <span className="font-mono">{fileInfo.totalChunks}</span>
                      </div>
                      <div className="flex justify-between text-gray-300">
                        <span>Hash:</span>
                        <span className="font-mono text-xs">{fileInfo.hash.substring(0, 16)}...</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <button
                      onClick={startUpdate}
                      disabled={!fileInfo || !config.apiKey || !config.deviceId || status !== 'idle'}
                      className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      Invia Comando START
                    </button>

                    <button
                      onClick={sendChunks}
                      disabled={status !== 'ready'}
                      className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      Invia Chunks
                    </button>

                    <div className="flex gap-2">
                      <button
                        onClick={requestStatus}
                        disabled={status === 'idle'}
                        className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Stato
                      </button>

                      <button
                        onClick={abortUpdate}
                        disabled={status === 'idle'}
                        className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
                      >
                        Annulla
                      </button>

                      <button
                        onClick={resetAll}
                        className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-colors"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  {status === 'sending' && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-gray-300">
                        <span>Progresso</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="w-full bg-slate-600 rounded-full h-3">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-cyan-500 h-3 rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-700 rounded-lg p-6">
                <h2 className="text-xl font-semibold text-white mb-4">Log Operazioni</h2>
                
                <div className="bg-slate-900 rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm space-y-1">
                  {logs.length === 0 ? (
                    <div className="text-gray-500 text-center py-8">
                      Nessuna operazione eseguita
                    </div>
                  ) : (
                    logs.map((log, index) => (
                      <div
                        key={index}
                        className={`flex items-start gap-2 ${
                          log.type === 'error' ? 'text-red-400' :
                          log.type === 'success' ? 'text-green-400' :
                          'text-gray-300'
                        }`}
                      >
                        <span className="text-gray-500 text-xs whitespace-nowrap">
                          {log.timestamp}
                        </span>
                        {log.type === 'error' && <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                        {log.type === 'success' && <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                        <span className="break-all">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-blue-300 mb-2 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Note Importanti
              </h3>
              <ul className="text-sm text-blue-200 space-y-1 list-disc list-inside">
                <li>Il device deve inviare un uplink per ricevere ogni messaggio downlink (Classe A)</li>
                <li>I chunks vengono accodati sul server TTN e inviati progressivamente</li>
                <li>Considera il duty cycle: delay di 2 secondi tra ogni chunk</li>
                <li>Per server locali TTN, usa http://IP:1885 (porta standard)</li>
                <li>Dimensione chunk: adatta in base allo Spreading Factor (SF7-SF12)</li>
                <li>Dopo l'invio di tutti i chunks, il device deve verificare e applicare l'aggiornamento</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}