const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// ==========================================
// BASE DE DATOS SIMPLE (en memoria)
// ==========================================
const licenses = new Map();

// Licencias de ejemplo (tú las creas para tus clientes)
licenses.set('ADBR-2024-001', {
    key: 'ADBR-2024-001',
    status: 'active',      // active, paused, suspended, expired
    clientName: 'Cliente Juan',
    createdAt: new Date('2024-01-01'),
    expiresAt: new Date('2024-12-31'),
    maxDevices: 2,
    devices: new Map(),    // dispositivos registrados
    suspendedReason: null
});

licenses.set('ADBR-2024-002', {
    key: 'ADBR-2024-002',
    status: 'active',
    clientName: 'Cliente Maria',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 días
    maxDevices: 1,
    devices: new Map(),
    suspendedReason: null
});

// ==========================================
// ENDPOINTS DE LICENCIA (para el bot)
// ==========================================

// Verificar licencia - LO USA EL BOT
app.post('/api/license/verify', (req, res) => {
    const { license_key, account_number, account_name, broker_name, computer_id, timestamp } = req.body;
    
    console.log('🔍 Verificando licencia:', license_key);
    console.log('   Dispositivo:', computer_id);
    console.log('   Cuenta MT5:', account_number);
    
    const license = licenses.get(license_key);
    
    if (!license) {
        return res.json({
            status: 'invalid',
            reason: 'Licencia no encontrada'
        });
    }
    
    // Verificar expiración
    if (new Date() > license.expiresAt) {
        return res.json({
            status: 'expired',
            reason: 'Licencia expirada el ' + license.expiresAt.toISOString()
        });
    }
    
    // Verificar si está suspendida
    if (license.status === 'suspended') {
        return res.json({
            status: 'suspended',
            reason: license.suspendedReason || 'Licencia suspendida por administrador'
        });
    }
    
    // Verificar si está pausada
    if (license.status === 'paused') {
        return res.json({
            status: 'paused',
            reason: 'Licencia pausada temporalmente'
        });
    }
    
    // Verificar límite de dispositivos
    if (!license.devices.has(computer_id)) {
        if (license.devices.size >= license.maxDevices) {
            return res.json({
                status: 'device_limit',
                reason: `Máximo ${license.maxDevices} dispositivos permitidos`,
                currentDevices: Array.from(license.devices.keys())
            });
        }
        // Registrar nuevo dispositivo
        license.devices.set(computer_id, {
            id: computer_id,
            accountNumber: account_number,
            broker: broker_name,
            firstSeen: new Date(),
            lastSeen: new Date()
        });
    } else {
        // Actualizar dispositivo existente
        const device = license.devices.get(computer_id);
        device.lastSeen = new Date();
        device.accountNumber = account_number;
    }
    
    // ÉXITO - Licencia válida
    res.json({
        status: 'active',
        licenseKey: license_key,
        clientName: license.clientName,
        expiresAt: license.expiresAt,
        maxDevices: license.maxDevices,
        currentDevices: license.devices.size,
        serverTime: new Date().toISOString()
    });
});

// Heartbeat - LO USA EL BOT CADA MINUTO
app.post('/api/license/heartbeat', (req, res) => {
    const { license_key, computer_id, event, balance, equity, profit, open_positions, total_trades, target_progress, timestamp } = req.body;
    
    const license = licenses.get(license_key);
    if (!license) return res.json({ status: 'error' });
    
    const device = license.devices.get(computer_id);
    if (device) {
        device.lastSeen = new Date();
        device.lastBalance = balance;
        device.lastProfit = profit;
    }
    
    console.log(`💓 Heartbeat: ${license_key} | ${event} | Balance: $${balance} | Profit: $${profit}`);
    
    res.json({ status: 'ok' });
});

// ==========================================
// PANEL DE ADMINISTRACIÓN (para ti)
// ==========================================

// Ver todas las licencias
app.get('/admin/licenses', (req, res) => {
    const list = Array.from(licenses.values()).map(l => ({
        key: l.key,
        clientName: l.clientName,
        status: l.status,
        devices: Array.from(l.devices.values()).map(d => ({
            id: d.id,
            accountNumber: d.accountNumber,
            broker: d.broker,
            lastSeen: d.lastSeen,
            isOnline: (new Date() - d.lastSeen) < 300000 // Online si heartbeat < 5 min
        })),
        expiresAt: l.expiresAt,
        createdAt: l.createdAt
    }));
    
    res.json(list);
});

// Suspender licencia
app.post('/admin/licenses/:key/suspend', (req, res) => {
    const { key } = req.params;
    const { reason } = req.body;
    
    const license = licenses.get(key);
    if (!license) return res.status(404).json({ error: 'No encontrada' });
    
    license.status = 'suspended';
    license.suspendedReason = reason || 'Suspendida por administrador';
    
    console.log(`🚫 Licencia ${key} suspendida: ${reason}`);
    
    res.json({ success: true, message: 'Licencia suspendida' });
});

// Pausar licencia
app.post('/admin/licenses/:key/pause', (req, res) => {
    const { key } = req.params;
    const license = licenses.get(key);
    
    if (!license) return res.status(404).json({ error: 'No encontrada' });
    
    license.status = 'paused';
    res.json({ success: true, message: 'Licencia pausada' });
});

// Reanudar licencia
app.post('/admin/licenses/:key/resume', (req, res) => {
    const { key } = req.params;
    const license = licenses.get(key);
    
    if (!license) return res.status(404).json({ error: 'No encontrada' });
    
    license.status = 'active';
    license.suspendedReason = null;
    res.json({ success: true, message: 'Licencia reanudada' });
});

// Extender expiración
app.post('/admin/licenses/:key/extend', (req, res) => {
    const { key } = req.params;
    const { days } = req.body;
    const license = licenses.get(key);
    
    if (!license) return res.status(404).json({ error: 'No encontrada' });
    
    license.expiresAt = new Date(license.expiresAt.getTime() + days * 24 * 60 * 60 * 1000);
    res.json({ success: true, newExpiry: license.expiresAt });
});

// Crear nueva licencia
app.post('/admin/licenses', (req, res) => {
    const { key, clientName, days, maxDevices } = req.body;
    
    licenses.set(key, {
        key: key,
        status: 'active',
        clientName: clientName,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        maxDevices: maxDevices || 2,
        devices: new Map(),
        suspendedReason: null
    });
    
    console.log(`✅ Nueva licencia creada: ${key} para ${clientName}`);
    res.json({ success: true, message: 'Licencia creada' });
});

// Dashboard HTML
app.get('/admin', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Adberry Bot - Admin Panel</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Segoe UI', sans-serif; 
                background: #0a0a0f; 
                color: #fff; 
                padding: 20px; 
            }
            .header { 
                background: linear-gradient(135deg, #00d4ff, #7b2cbf); 
                padding: 30px; 
                border-radius: 15px; 
                margin-bottom: 30px;
                box-shadow: 0 10px 40px rgba(0,212,255,0.3);
            }
            .header h1 { font-size: 28px; margin-bottom: 10px; }
            .stats { 
                display: grid; 
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
                gap: 20px; 
                margin-bottom: 30px; 
            }
            .stat-card { 
                background: #15151f; 
                padding: 25px; 
                border-radius: 12px; 
                border: 1px solid #2a2a3a;
                transition: transform 0.3s;
            }
            .stat-card:hover { transform: translateY(-5px); }
            .stat-value { font-size: 36px; font-weight: bold; color: #00d4ff; }
            .stat-label { color: #6b6b7b; font-size: 12px; text-transform: uppercase; margin-top: 8px; }
            .section { 
                background: #15151f; 
                border-radius: 15px; 
                padding: 25px; 
                margin-bottom: 30px; 
                border: 1px solid #2a2a3a;
            }
            .section-title { 
                font-size: 20px; 
                margin-bottom: 20px; 
                color: #00d4ff;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            table { width: 100%; border-collapse: collapse; }
            th { 
                text-align: left; 
                padding: 15px; 
                color: #6b6b7b; 
                font-weight: 600; 
                border-bottom: 2px solid #2a2a3a;
                font-size: 12px;
                text-transform: uppercase;
            }
            td { padding: 15px; border-bottom: 1px solid #2a2a3a; }
            .badge { 
                padding: 6px 14px; 
                border-radius: 20px; 
                font-size: 11px; 
                font-weight: 700;
                text-transform: uppercase;
            }
            .badge-active { background: #00d4ff20; color: #00d4ff; border: 1px solid #00d4ff; }
            .badge-suspended { background: #ff444420; color: #ff4444; border: 1px solid #ff4444; }
            .badge-paused { background: #ffaa0020; color: #ffaa00; border: 1px solid #ffaa00; }
            .btn { 
                padding: 10px 20px; 
                border: none; 
                border-radius: 8px; 
                cursor: pointer; 
                font-size: 12px;
                font-weight: 600;
                margin-right: 8px;
                transition: all 0.3s;
            }
            .btn:hover { transform: scale(1.05); }
            .btn-danger { background: #ff4444; color: white; }
            .btn-warning { background: #ffaa00; color: #000; }
            .btn-success { background: #00d4ff; color: #000; }
            .btn-secondary { background: #2a2a3a; color: #fff; }
            .device-indicator { 
                display: inline-block; 
                width: 8px; 
                height: 8px; 
                border-radius: 50%; 
                margin-right: 8px; 
            }
            .device-online { background: #00d4ff; box-shadow: 0 0 10px #00d4ff; }
            .device-offline { background: #ff4444; }
            .profit-positive { color: #00d4ff; font-weight: bold; }
            .profit-negative { color: #ff4444; font-weight: bold; }
            .live-indicator { 
                display: inline-flex; 
                align-items: center; 
                gap: 10px; 
                color: #00d4ff; 
                font-size: 14px;
                margin-top: 10px;
            }
            .pulse { 
                width: 10px; 
                height: 10px; 
                background: #00d4ff; 
                border-radius: 50%; 
                animation: pulse 2s infinite; 
            }
            @keyframes pulse { 
                0%, 100% { opacity: 1; transform: scale(1); } 
                50% { opacity: 0.5; transform: scale(1.2); } 
            }
            .form-group { margin-bottom: 15px; }
            .form-group label { display: block; margin-bottom: 5px; color: #6b6b7b; font-size: 12px; }
            .form-group input { 
                width: 100%; 
                padding: 12px; 
                background: #0a0a0f; 
                border: 1px solid #2a2a3a; 
                border-radius: 8px; 
                color: #fff;
                font-size: 14px;
            }
            .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🤖 Adberry Bot Admin Panel</h1>
            <p>Sistema de Control de Licencias</p>
            <div class="live-indicator">
                <div class="pulse"></div>
                Sistema en vivo • <span id="currentTime"></span>
            </div>
        </div>
        
        <div class="stats" id="stats">
            <div class="stat-card">
                <div class="stat-value" id="totalLicenses">0</div>
                <div class="stat-label">Total Licencias</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="activeLicenses" style="color: #00d4ff">0</div>
                <div class="stat-label">Licencias Activas</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="suspendedLicenses" style="color: #ff4444">0</div>
                <div class="stat-label">Suspendidas</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="onlineBots" style="color: #7b2cbf">0</div>
                <div class="stat-label">Bots Online</div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">➕ Crear Nueva Licencia</div>
            <div class="form-row">
                <div class="form-group">
                    <label>Clave de Licencia</label>
                    <input type="text" id="newKey" placeholder="ADBR-2024-XXX" value="ADBR-2024-">
                </div>
                <div class="form-group">
                    <label>Nombre del Cliente</label>
                    <input type="text" id="newClient" placeholder="Nombre del cliente">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Días de vigencia</label>
                    <input type="number" id="newDays" value="30" min="1">
                </div>
                <div class="form-group">
                    <label>Máximo de dispositivos</label>
                    <input type="number" id="newDevices" value="2" min="1" max="5">
                </div>
            </div>
            <button class="btn btn-success" onclick="createLicense()">Crear Licencia</button>
        </div>
        
        <div class="section">
            <div class="section-title">🔐 Gestión de Licencias</div>
            <div id="licensesTable"></div>
        </div>

        <script>
            function updateTime() {
                document.getElementById('currentTime').textContent = new Date().toLocaleString();
            }
            setInterval(updateTime, 1000);
            updateTime();
            
            async function loadStats() {
                try {
                    const res = await fetch('/admin/licenses');
                    const licenses = await res.json();
                    
                    const total = licenses.length;
                    const active = licenses.filter(l => l.status === 'active').length;
                    const suspended = licenses.filter(l => l.status === 'suspended').length;
                    const online = licenses.reduce((acc, l) => 
                        acc + l.devices.filter(d => d.isOnline).length, 0);
                    
                    document.getElementById('totalLicenses').textContent = total;
                    document.getElementById('activeLicenses').textContent = active;
                    document.getElementById('suspendedLicenses').textContent = suspended;
                    document.getElementById('onlineBots').textContent = online;
                } catch (e) { console.error('Error cargando stats:', e); }
            }
            
            async function loadLicenses() {
                try {
                    const res = await fetch('/admin/licenses');
                    const licenses = await res.json();
                    
                    let html = '<table><tr><th>Licencia</th><th>Cliente</th><th>Estado</th><th>Dispositivos</th><th>Expira</th><th>Acciones</th></tr>';
                    
                    licenses.forEach(l => {
                        const statusClass = l.status === 'active' ? 'badge-active' : 
                                          l.status === 'suspended' ? 'badge-suspended' : 'badge-paused';
                        const statusText = l.status.toUpperCase();
                        
                        const devicesList = l.devices.map(d => 
                            `<span class="device-indicator ${d.isOnline ? 'device-online' : 'device-offline'}"></span>${d.accountNumber || 'N/A'}`
                        ).join('<br>');
                        
                        html += \`
                            <tr>
                                <td><code>\${l.key}</code></td>
                                <td>\${l.clientName}</td>
                                <td><span class="badge \${statusClass}">\${statusText}</span></td>
                                <td>\${devicesList || 'Sin dispositivos'}</td>
                                <td>\${new Date(l.expiresAt).toLocaleDateString()}</td>
                                <td>
                                    \${l.status !== 'suspended' ? 
                                        \`<button class="btn btn-danger" onclick="suspend('\${l.key}')">Suspender</button>
                                         <button class="btn btn-warning" onclick="pause('\${l.key}')">Pausar</button>\` : 
                                        \`<button class="btn btn-success" onclick="resume('\${l.key}')">Reanudar</button>\`
                                    }
                                    <button class="btn btn-secondary" onclick="extend('\${l.key}')">+30 días</button>
                                </td>
                            </tr>
                        \`;
                    });
                    
                    html += '</table>';
                    document.getElementById('licensesTable').innerHTML = html;
                } catch (e) { console.error('Error cargando licencias:', e); }
            }
            
            async function createLicense() {
                const key = document.getElementById('newKey').value;
                const client = document.getElementById('newClient').value;
                const days = parseInt(document.getElementById('newDays').value);
                const devices = parseInt(document.getElementById('newDevices').value);
                
                if (!key || !client) {
                    alert('Completa todos los campos');
                    return;
                }
                
                await fetch('/admin/licenses', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({key, clientName: client, days, maxDevices: devices})
                });
                
                alert('Licencia creada exitosamente');
                loadLicenses();
                loadStats();
            }
            
            async function suspend(key) {
                const reason = prompt('Motivo de suspensión:');
                if (!reason) return;
                
                await fetch(\`/admin/licenses/\${key}/suspend\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({reason})
                });
                
                alert('Licencia suspendida');
                loadLicenses();
                loadStats();
            }
            
            async function pause(key) {
                await fetch(\`/admin/licenses/\${key}/pause\`, {method: 'POST'});
                alert('Licencia pausada');
                loadLicenses();
                loadStats();
            }
            
            async function resume(key) {
                await fetch(\`/admin/licenses/\${key}/resume\`, {method: 'POST'});
                alert('Licencia reanudada');
                loadLicenses();
                loadStats();
            }
            
            async function extend(key) {
                await fetch(\`/admin/licenses/\${key}/extend\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({days: 30})
                });
                alert('Licencia extendida 30 días');
                loadLicenses();
            }
            
            // Cargar datos
            loadStats();
            loadLicenses();
            
            // Auto-refresh cada 5 segundos
            setInterval(() => {
                loadStats();
                loadLicenses();
            }, 5000);
        </script>
    </body>
    </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📊 Panel Admin: http://localhost:${PORT}/admin`);
});