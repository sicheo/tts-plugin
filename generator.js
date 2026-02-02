const fs = require('fs');
const Papa = require('papaparse');

// Template di configurazione base
const baseConfig = {
  "ohms_firmware_version": 1, // versione firmware
  "ohms_serial": "0000", // seriale device
  "cpu_frequency": 80, // frequenza cpu default in MHz
  "cpu_freq_power_save": 80, // frequenza cpu in energy saving mode in MHz
  "cpu_freq_critical": 40, // frequenza cpu in modalità critica in MHz
  "cpu_mac": "000000000000", // mac cpu
  "target_file": "terna_config005.json", // file traget per update firmware
  "temp_file": "update.tmp", // file temporaneo per update firmware
  "mqtt_server": "10.147.131.28", // mqtt server per accesso diretto via LTE
  "mqtt_client_id": "Sicheo-digil-gateway", // mqtt client-id
  "mqtt_port": 31883, // porta server mqtt
  "mqtt_user": "Sicheo-digil-gateway_acf23911-a7ae-4d11-a34d-296137d69c45@c62e55b3-65b7-4ea3-8b2f-ce5b3086b426", // userid accesso server mqtt
  "mqtt_password": "pLMoKN2024$$", // password accesso server mqtt
  "mqtt_vendor_id": "Sicheo", // id vendor
  "mqtt_device_id": "1:1:2:21:27:DIGIL_SIC_", // preambolo device ID
  "mqtt_application_id": "DEV_1-1-2-21-27-DIGIL_SIC_0005_V1", // application ID
  "mqtt_diag_topic": "diag", // subtopic per pubblicazione diagnostiche
  "mqtt_data_topic": "data", // subtopic per pubblicazione dati
  "mqtt_cyclic_topic": "cicliche", // subtopic per pubblicazione grandezze cicliche
  "mqtt_spont_topic": "spontanee", // subtopic per pubblicazione allarmi ed eventi
  "lte_apn": "nb-iot", // apn LTE
  "lte_debug": "OFF", // LTE debug flag
  "lte_mode": "NBIOT", // LTE mode
  "lte_cid": 1, // LTE cid
  "lte_username":"23534D1-034A@nbiot.terna.it", // LTE access username
  "lte_password":"034Anbiot23534D1", // LTE access password
  "lora_type": "OTAA", // Lora join mode
  "lora_version": "VERSION_1_1_X", // Lora version
  "lora_DevEUI": "7C5189FFFF022E00", // Lora DevEui
  "lora_AppKey": "EC403152361A18A17C5189FFFF022E00", // Lora AppKey
  "lora_NwKey": "E0403152361A18A17C5189FFFF022E00", // Lora NwKey
  "lora_JoinEUI": "0000000000000000", // Lora JoinEui
  "lora_region": "REGION_EU68", // Lora region
  "lora_class": "CLASS_A", // Lora device Class
  "lora_mode": "WAN", // Lora mode
  "lora_port": 1, // Lora data port
  "lora_port_update": 200, // Lora update port
  "lora_dutycycle": 60000, // Lora dutycycle in usec
  "fbg_sample_freq": 1000, // frequenza campionamento misure in usec
  "fbg_sample_window": 900, // numero di campionamenti per calcolo media
  "fbg_uart": 2, // Uart di comunicazione con illuminatore
  "fbg_uart_baudrate": 3000000, // Uart baudrate
  "fbg_uart_databit": 8, // Uart data bit
  "fbg_uart_stopbit": 1, // Uart stop bit
  "fbg_uart_parity": "N", // Uart parity
  "fbg_uart_timeout": 200, // Uart timeout in sec.
  "param_F_alow": 0.2, // soglia allarme tiro basso
  "param_F_ahigh": 0.4, // soglia allarme tiro alto
  "param_cable_E": 68000, // coeff. modulo Young in uPa
  "param_cable_F_zero":0, // valore in kN del tiro nominale
  "param_cable_F_max":0, // valore in kN del tiro massimo
  "param_cable_H": 80, // 
  "param_cable_section": 0.0004883, // sezione cavo in m2
  "param_cable_T_zero": 25, // valore temperatura per calcolo F0 in °C
  "param_cable_L_zero": 100, // lunghezza tratta cavo
  "param_cable_alfa": 1,
  "param_cable_ro": 1,
  "param_low_battery": 3.578, // soglia batteria bassa - invia allarme
  "battery_critical_level": 3.574, // soglia batteria critica - disabilita radio
  "battery_shutdown_level": 3.57, // il sistema va in deep sleep
  "charging_wakeup_minutes": 15, // periodo controllo se carica in corso in minuti
  "critical_wakeup_minutes": 60, // periodo di sleep in condizione critica 
  "enable_battery_manager": true, // Abilita/disabilita Battery Manager
  "battery_shutdown_retries": 3, // Numero di misure consecutive sotto soglia prima dello shutdown
  "max_deep_sleep_cycles": 48, // massimo numero di cicli in deepsleep
  "enable_battery_logging": false, // abilita logging eventi batteria
  "panic_shutdown_level": 3, // Shutdown immediato senza retry a questo livello (%)
  "param_tag_fase": "4", // FASE
  "param_tag_line": "1", // LINEA
  "param_tag_side": "B", // SIDE
  "param_sensor_serial": "278331/0003", // Seriale sensore
  "param_temp_s1":-988609, // Coeff. s1 per calcolo temperatura assoluta
  "param_temp_s2":41318.24, // Coeff. s2 per calcolo temperatura assoluta
  "param_temp_s3":22.49595, // Coeff. s3 per calcolo temperatura assoluta
  "param_temp_f0":8293268, // frequenza riferimento per calcolo temperatura assoluta in nm*10000
  "param_temp_correction": 50, // correzione temperatrura per bug nel plugin
  "param_strain_f0":8580000, // frequenza di riferimento per impostazione finestra illuminatore in nm*10000
  "param_strain_fwind":5000, // ampiezza finestra illuminatore 
  "param_strain_A":-0.0000000785907, // coefficiente A per calcolo strain
  "param_strain_B":0.000000574248, // coefficiente B per calcolo strain
  "param_strain_Lff":0.1385, // lunghezza f.o. sensore in m
  "param_strain_CTE":25, // coeff. dilatazione termica sensore
  "param_strain_Lfal":0.1385 // lunghezza di montaggio sensore in m
};

// Leggi il file CSV
const csvFilePath = 'sensori.csv';
const csvData = fs.readFileSync(csvFilePath, 'utf8');

// Parse del CSV
const parsed = Papa.parse(csvData, {
  header: true,
  skipEmptyLines: true
});

// Genera i file di configurazione
parsed.data.forEach((row) => {
  const comp = "D"
  if(comp == row.TIPO){
    // Crea una copia del template base
    const config = JSON.parse(JSON.stringify(baseConfig));
    
    // Aggiorna i campi specifici dal CSV
    const seriale = row.CLIENTID.split("_").pop();
    
    config.ohms_serial = seriale.padStart(4, '0');
    config.cpu_mac = row.MAC;
    config.lora_DevEUI = row.DEVEUI;
    config.lora_AppKey = row.APPKEY;
    config.lora_NwKey = row.NETKEY;
    config.param_tag_fase = row.FASE;
    config.param_tag_line = row.LINEA;
    config.param_tag_side = row.SIDE;
    config.lte_username = row.USERNAME;
    config.lte_password = row.PASSWORD;
    config.param_sensor_serial = row.SENSID;
    config.param_strain_A = parseFloat(row.A);
    config.param_strain_B = parseFloat(row.B);
    config.param_strain_Lff = parseFloat(row.LFFL);
    config.param_strain_CTE = parseInt(row.CTE);
    config.param_temp_s1 = parseFloat(row.S1);
    config.param_temp_s2 = parseFloat(row.S2);
    config.param_temp_s3 = parseFloat(row.S3);
    config.param_temp_f0 = parseInt(row.LTREF*10000);
    config.param_strain_Lfal = config.param_strain_Lff;
    config.param_cable_F_zero = parseInt(row.F0);
    config.param_cable_F_max = parseInt(row.FMAX);
    config.param_F_ahigh = parseFloat(row.FPERCH);
    config.param_F_alow = parseFloat(row.FPERL);
    config.param_cable_section = parseFloat(row.SECTION);
    
    // Genera mqtt_application_id
    config.mqtt_application_id = `DEV_1-1-2-21-27-DIGIL_SIC_${seriale.padStart(4, '0')}_V1`;
    
    // Nome del file di output
    const outputFileName = `terna_config_${seriale.padStart(4, '0')}.json`;

    config.target_file = outputFileName;

    // Scrivi il file JSON
    fs.writeFileSync(outputFileName, JSON.stringify(config, null, 2), 'utf8');
    
    console.log(`Creato: ${outputFileName}`);
  }
});

console.log('\nGenerazione completata!');