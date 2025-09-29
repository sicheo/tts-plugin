/**
 * Payload Formatter per The Things Stack - Sensore LoRa Digil2
 * Decodifica i messaggi uplink dal sensore secondo le specifiche fornite
 */

function decodeUplink(input) {
  const bytes = input.bytes;
  const fPort = input.fPort;
  
  if (bytes.length === 0) {
    return {
      data: {},
      warnings: ["Payload vuoto"],
      errors: []
    };
  }

  try {
    const result = parseLoRaPayload(bytes);
    
    return {
      data: {
        metrics: result.metrics,
        QC: result.qc || 0,
        TIMESTAMP: Math.floor(Date.now() / 1000)
      },
      warnings: result.warnings || [],
      errors: result.errors || []
    };
  } catch (error) {
    return {
      data: {},
      warnings: [],
      errors: [`Errore di decodifica: ${error.message}`]
    };
  }
}

function parseLoRaPayload(bytes) {
  let index = 0;
  const metrics = {};
  const warnings = [];
  const errors = [];

  if (bytes.length < 1) {
    throw new Error("Payload troppo corto");
  }

  // Parsing header (primo byte)
  const headerByte = bytes[index++];
  const startBit = (headerByte >> 7) & 0x01; // bit 7
  const fase = (headerByte >> 5) & 0x03;     // bit 6-5
  const side = (headerByte >> 3) & 0x03;     // bit 4-3
  const line = (headerByte >> 1) & 0x03;     // bit 2-1

  if (startBit !== 1) {
    warnings.push("Start bit non valido");
  }

  // Decodifica fase, side, line
  const faseMap = { 0: 4, 1: 8, 2: 12 };
  const sideMap = { 0: 'A', 1: 'B' };
  const lineMap = { 0: 1, 1: 2 };

  const faseValue = faseMap[fase];
  const sideValue = sideMap[side];
  const lineValue = lineMap[line];

  // Parsing metriche
  while (index < bytes.length) {
    if (index >= bytes.length) break;

    const opcodeByte = bytes[index++];
    const metricId = (opcodeByte >> 2) & 0x3F;  // 6 bit superiori
    const length = opcodeByte & 0x03;           // 2 bit inferiori

    let value;
    let valueBytes;

    // Caso speciale per evento device boot (id 0x28 = 40)
    if (metricId === 40) { // 0b101000
      // Legge 17 caratteri per il timestamp del boot
      const bootDataLength = Math.min(17, bytes.length - index);
      valueBytes = bytes.slice(index, index + bootDataLength);
      index += bootDataLength;
      
      // Converte in stringa
      let bootString = '';
      for (let i = 0; i < valueBytes.length; i++) {
        bootString += String.fromCharCode(valueBytes[i]);
      }
      value = bootString;
    } else {
      // Determina lunghezza valore
      const valueLength = length === 0 ? 1 : length === 1 ? 2 : length === 2 ? 3 : 4;
      
      if (index + valueLength > bytes.length) {
        errors.push(`Dati insufficienti per metrica ID ${metricId}`);
        break;
      }

      valueBytes = bytes.slice(index, index + valueLength);
      index += valueLength;

      // Converte valore
      if (valueLength === 1) {
        value = valueBytes[0];
      } else if (valueLength === 2) {
        value = (valueBytes[0] << 8) | valueBytes[1];
      } else if (valueLength === 3) {
        value = (valueBytes[0] << 16) | (valueBytes[1] << 8) | valueBytes[2];
      } else {
        value = (valueBytes[0] << 24) | (valueBytes[1] << 16) | (valueBytes[2] << 8) | valueBytes[3];
      }
    }

    // Mappa metrica a nome e suffisso
    const metricInfo = getMetricInfo(metricId, faseValue, sideValue, lineValue);
    if (metricInfo) {
      let processedValue = processValue(metricId, value);
      metrics[metricInfo.name + metricInfo.suffix] = processedValue;
    } else {
      warnings.push(`Metrica sconosciuta con ID ${metricId}`);
    }
  }

  return {
    metrics,
    warnings,
    errors,
    qc: 1
  };
}

function getMetricInfo(metricId, fase, side, line) {
  const metricMappings = {
    // Metriche cicliche
    1: { type: 'tiro', stat: 'avg' },    // media tiro
    2: { type: 'tiro', stat: 'max' },    // max tiro
    3: { type: 'tiro', stat: 'min' },    // min tiro
    4: { type: 'temp', stat: 'avg' },    // media temp
    5: { type: 'temp', stat: 'max' },    // max temp
    6: { type: 'temp', stat: 'min' },    // min temp
    7: { name: 'ALG_FBG_Liv_Batteria', suffix: '.calc' },
    8: { name: 'ALG_FBG_Stato_Canale_UART', suffix: '.calc' },
    9: { name: 'ALG_FBG_Stato_Canale_Lora', suffix: '.calc' },
    10: { name: 'ALG_FBG_Stato_Canale_NBIoT', suffix: '.calc' },

    // Allarmi spontanei
    32: { type: 'alarm_tiro', stat: 'min' },  // allarme tiro basso
    33: { type: 'alarm_tiro', stat: 'max' },  // allarme tiro alto
    34: { type: 'warning_tiro', stat: 'min' }, // warning tiro basso - not used
    35: { type: 'warning_tiro', stat: 'max' }, // warning tiro alto - not used
    36: { name: 'ALG_FBG_Alm_Batteria_Bassa', suffix: '.calc' },
    37: { name: 'ALG_FBG_Canale_UART_OFF', suffix: '.calc' },
    38: { name: 'ALG_FBG_Canale_Lora_OFF', suffix: '.calc' },
    39: { name: 'ALG_FBG_Canale_NBIoT_OFF', suffix: '.calc' },
    40: { name: 'ALG_FBG_Start_Up_Device', suffix: '.calc' }
  };

  const mapping = metricMappings[metricId];
  if (!mapping) return null;

  // Se ha già nome e suffisso definiti, ritorna direttamente
  if (mapping.name && mapping.suffix) {
    return mapping;
  }

  // Costruisce nome dinamicamente per tiro e temperatura
  let name, suffix;

  if (mapping.type === 'temp') {
    name = `SENS_FBG_Temp_F${fase}${side}_L${line}`;
    suffix = '.' + mapping.stat;
  } else if (mapping.type === 'tiro') {
    name = `SENS_FBG_TC_F${fase}${side}_L${line}`;
    suffix = '.' + mapping.stat;
  } else if (mapping.type === 'alarm_tiro') {
    const statName = mapping.stat === 'min' ? 'Bassa' : 'Alta';
    name = `ALG_FBG_Alm_Tiro_${statName}_F${fase}${side}_L${line}`;
    suffix = '.calc';
  } else if (mapping.type === 'warning_tiro') {
    const statName = mapping.stat === 'min' ? 'Min' : 'Max';
    name = `ALG_FBG_Warn_Tiro_${statName}_F${fase}${side}_L${line}`; // non utilizzato
    suffix = '.calc';
  }

  return name && suffix ? { name, suffix } : null;
}

function processValue(metricId, rawValue) {
  // Applica le trasformazioni specifiche secondo la tabella
  switch (metricId) {
    case 1: case 2: case 3: // tiro (kN)
      return rawValue; // 0-255 kN
    
    case 4: case 5: case 6: // temperatura (°C)
      return rawValue - 50; // offset -50 per range -35 +220 °C
    
    case 7: // livello batteria (%)
      return rawValue; // 0-100 %
    
    case 8: // stato UART
      return rawValue; // codice stato
    
    case 9: case 10: // stato Lora/NB-IoT
      return rawValue; // 0 or 1
    
    case 32: case 33: case 34: case 35: // allarmi e warning
    case 36: case 37: case 38: case 39:
      return rawValue; // 0 or 1
    
    case 40: // evento boot
      return rawValue; // stringa timestamp
    
    default:
      return rawValue;
  }
}

// Funzione per encoding (se necessaria per downlink)
function encodeDownlink(input) {
  return {
    bytes: [],
    fPort: 1,
    warnings: [],
    errors: ["Downlink non implementato"]
  };
}

