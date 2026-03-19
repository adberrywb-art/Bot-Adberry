const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// ==========================================
// BASE DE DATOS EN MEMORIA
// ==========================================
const licenses = new Map();

// Licencias de ejemplo (puedes agregar más desde el panel)
licenses.set('ADBR-001-DEMO', {
    key: 'ADBR-001-DEMO',
    status: 'active',
    clientName: 'Cliente Demo',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    maxDevices: 2,
    devices: new Map(),
    suspendedReason: null
});

// ==========================================
// ENDPOINTS PARA EL BOT
// ==========================================

// Verificar licencia
app.post('/api/license/verify', (req, res) => {
    const { license_key, account_number, account_name, broker_name, computer_id, timestamp } = req.body;
    
    console.log('🔍 Verificando:', license_key, '| Dispositivo:', computer_id);
    
    const license = licenses.get(license_key);
    
    if (!license) {
        return res.json({ status: 'invalid', reason: 'Licencia no encontrada' });
    }
    
    // Verificar expiración
    if (new Date() > license.expiresAt) {
        return res.json({ status: 'expired', reason: 'Licencia expirada' });
    }
    
    // Verificar suspensión
    if (license.status === 'suspended') {
        return res.json({ 
            status: 'suspended', 
            reason: license.suspendedReason || 'Suspendida por administrador' 
        });
    }
    
    if (license.status === 'paused') {
        return res.json({ status: 'paused', reason: 'Licencia pausada temporalmente' });
    }
    
    // Verificar dispositivos
    if (!license.devices.has(computer_id)) {
        if (license.devices.size >= license.maxDevices) {
            return res.json({ 
                status: 'device_limit', 
                reason: `Máximo ${license.maxDevices} dispositivos` 
            });
        }
        license.devices.set(computer_id, {
            id: computer_id,
            accountNumber: account_number,
            broker: broker_name,
            firstSeen: new Date(),
            lastSeen: new Date()
        });
    } else {
        license.devices.get(computer_id).lastSeen = new Date();
    }
    
    res.json({
        status: 'active',
        licenseKey: license_key,
        expiresAt: license.expiresAt,
        maxDevices: license.maxDevices,
        currentDevices: license.devices.size
    });
});

// Heartbeat
app.post('/api/license/heartbeat', (req, res) => {
    const { license_key, computer_id, event, balance, profit, open_positions } = req.body;
    
    const license = licenses.get(license_key);
    if (license && license.devices.has(computer_id)) {
        const device = license.devices.get(computer_id);
        device.lastSeen = new Date();
        device.lastBalance = balance;
        device.lastProfit = profit;
        device.lastEvent = event;
    }
    
    console.log(`💓 ${license_key} | ${event} | Balance: $${balance} | Profit: $${profit}`);
    res.json({ status: 'ok' });
});

// ==========================================
// PANEL DE ADMINISTRACIÓN
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
            isOnline: (new Date() - d.lastSeen) < 300000
        })),
        expiresAt: l.expiresAt
    }));
    res.json(list);
});

// Crear licencia
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
    
    console.log(`✅ Nueva licencia: ${key}`);
    res.json({ success: true });
});

// Suspender
app.post('/admin/licenses/:key/suspend', (req, res) => {
    const license = licenses.get(req.params.key);
    if (!license) return res.status(404).json({ error: 'No encontrada' });
    
    license.status = 'suspended';
    license.suspendedReason = req.body.reason || 'Suspendida por admin';
    res.json({ success: true });
});

// Pausar
app.post('/admin/licenses/:key/pause', (req, res) => {
    const license = licenses.get(req.params.key);
    if (!license) return res.status(404).json({ error: 'No encontrada' });
    
    license.status = 'paused';
    res.json({ success: true });
});

// Reanudar
app.post('/admin/licenses/:key/resume', (req, res) => {
    const license = licenses.get(req.params.key);
    if (!license) return res.status(404).json({ error: 'No encontrada' });
    
    license.status = 'active';
    license.suspendedReason = null;
    res.json({ success: true });
});

// Extender
app.post('/admin/licenses/:key/extend', (req, res) => {
    const license = licenses.get(req.params.key);
    if (!license) return res.status(404).json({ error: 'No encontrada' });
    
    license.expiresAt = new Date(license.expiresAt.getTime() + req.body.days * 24 * 60 * 60 * 1000);
    res.json({ success: true, newExpiry: license.expiresAt });
});

// Panel HTML
app.get('/admin', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Adberry Bot - Admin</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                background: #0f0f14; 
                color: #fff; 
                padding: 20px; 
                line-height: 1.6;
            }
            .header { 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                padding: 30px; 
                border-radius: 16px; 
                margin-bottom: 30px;
            }
            .header h1 { font-size: 28px; margin-bottom: 5px; }
            .header p { opacity: 0.9; }
            .stats { 
                display: grid; 
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); 
                gap: 20px; 
                margin-bottom: 30px; 
            }
            .stat-card { 
                background: #1a1a23; 
                padding: 20px; 
                border-radius: 12px; 
                border: 1px solid #2a2a35;
            }
            .stat-value { font-size: 32px; font-weight: bold; color: #667eea; }
            .stat-label { color: #6b6b7b; font-size: 12px; text-transform: uppercase; margin-top: 5px; }
            .section { 
                background: #1a1a23; 
                border-radius: 16px; 
                padding: 25px; 
                margin-bottom: 25px; 
                border: 1px solid #2a2a35;
            }
            .section-title { 
                font-size: 18px; 
                margin-bottom: 20px; 
                color: #667eea;
                font-weight: 600;
            }
            table { width: 100%; border-collapse: collapse; font-size: 14px; }
            th { 
                text-align: left; 
                padding: 12px; 
                color: #6b6b7b; 
                font-weight: 600; 
                border-bottom: 2px solid #2a2a35;
                font-size: 11px;
                text-transform: uppercase;
            }
            td { padding: 12px; border-bottom: 1px solid #2a2a35; }
            .badge { 
                padding: 5px 12px; 
                border-radius: 20px; 
                font-size: 11px; 
                font-weight: 600;
                text-transform: uppercase;
            }
            .badge-active { background: #10b98120; color: #10b981; border: 1px solid #10b981; }
            .badge-suspended { background: #ef444420; color: #ef4444; border: 1px solid #ef4444; }
            .badge-paused { background: #f59e0b20; color: #f59e0b; border: 1px solid #f59e0b; }
            .btn { 
                padding: 8px 16px; 
                border: none; 
                border-radius: 8px; 
                cursor: pointer; 
                font-size: 12px;
                font-weight: 500;
                margin-right: 6px;
                transition: all 0.2s;
            }
            .btn:hover { opacity: 0.8; transform: translateY(-1px); }
            .btn-danger { background: #ef4444; color: white; }
            .btn-warning { background: #f59e0b; color: #000; }
            .btn-success { background: #10b981; color: white; }
            .btn-primary { background: #667eea; color: white; }
            .device-indicator { 
                display: inline-block; 
                width: 8px; 
                height: 8px; 
                border-radius: 50%; 
                margin-right: 6px; 
            }
            .device-online { background: #10b981; box-shadow: 0 0 8px #10b981; }
            .device-offline { background: #ef4444; }
            .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; }
            .form-group { display: flex; flex-direction: column; }
            .form-group label { font-size: 12px; color: #6b6b7b; margin-bottom: 5px; text-transform: uppercase; }
            .form-group input { 
                padding: 10px; 
                background: #0f0f14; 
                border: 1px solid #2a2a35; 
                border-radius: 8px; 
                color: #fff;
                font-size: 14px;
            }
            .form-group input:focus { outline: none; border-color: #667eea; }
            .live-badge { 
                display: inline-flex; 
                align-items: center; 
                gap: 8px; 
                background: #10b98120; 
                color: #10b981;
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 12px;
                margin-top: 10px;
            }
            .pulse { 
                width: 8px; 
                height: 8px; 
                background: #10b981; 
                border-radius: 50%; 
                animation: pulse 2s infinite; 
            }
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🤖 Adberry Bot Control</h1>
            <p>Sistema de Licencias y Monitoreo</p>
            <div class="live-badge">
                <div class="pulse"></div>
                Sistema en vivo
            </div>
        </div>
        
        <div class="stats" id="stats"></div>
        
        <div class="section">
            <div class="section-title">➕ Crear Nueva Licencia</div>
            <div class="form-grid">
                <div class="form-group">
                    <label>Clave de Licencia</label>
                    <input type="text" id="newKey" placeholder="ADBR-2024-001" value="ADBR-2024-">
                </div>
                <div class="form-group">
                    <label>Nombre del Cliente</label>
                    <input type="text" id="newClient" placeholder="Juan Pérez">
                </div>
                <div class="form-group">
                    <label>Días de vigencia</label>
                    <input type="number" id="newDays" value="30" min="1">
                </div>
                <div class="form-group">
                    <label>Máx. dispositivos</label>
                    <input type="number" id="newDevices" value="2" min="1" max="5">
                </div>
            </div>
            <button class="btn btn-primary" onclick="createLicense()">Crear Licencia</button>
        </div>
        
        <div class="section">
            <div class="section-title">🔐 Licencias Activas</div>
            <div id="licensesTable">Cargando...</div>
        </div>

        <script>
            async function loadStats() {
                try {
                    const res = await fetch('/admin/licenses');
                    const licenses = await res.json();
                    
                    const total = licenses.length;
                    const active = licenses.filter(l => l.status === 'active').length;
                    const suspended = licenses.filter(l => l.status === 'suspended').length;
                    const online = licenses.reduce((acc, l) => 
                        acc + l.devices.filter(d => d.isOnline).length, 0);
                    
                    document.getElementById('stats').innerHTML = \`
                        <div class="stat-card">
                            <div class="stat-value">\${total}</div>
                            <div class="stat-label">Total Licencias</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value" style="color: #10b981">\${active}</div>
                            <div class="stat-label">Activas</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value" style="color: #ef4444">\${suspended}</div>
                            <div class="stat-label">Suspendidas</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value" style="color: #667eea">\${online}</div>
                            <div class="stat-label">Bots Online</div>
                        </div>
                    \`;
                } catch (e) { console.error('Error:', e); }
            }
            
            async function loadLicenses() {
                try {
                    const res = await fetch('/admin/licenses');
                    const licenses = await res.json();
                    
                    if (licenses.length === 0) {
                        document.getElementById('licensesTable').innerHTML = '<p style="color: #6b6b7b;">No hay licencias creadas</p>';
                        return;
                    }
                    
                    let html = '<table><tr><th>Licencia</th><th>Cliente</th><th>Estado</th><th>Dispositivos</th><th>Expira</th><th>Acciones</th></tr>';
                    
                    licenses.forEach(l => {
                        const statusClass = l.status === 'active' ? 'badge-active' : 
                                          l.status === 'suspended' ? 'badge-suspended' : 'badge-paused';
                        const statusText = l.status.toUpperCase();
                        
                        const devices = l.devices.map(d => 
                            \`<span class="device-indicator \${d.isOnline ? 'device-online' : 'device-offline'}"></span>
                             \${d.accountNumber || 'N/A'}\`
                        ).join('<br>') || 'Sin dispositivos';
                        
                        html += \`
                            <tr>
                                <td><code>\${l.key}</code></td>
                                <td>\${l.clientName}</td>
                                <td><span class="badge \${statusClass}">\${statusText}</span></td>
                                <td>\${devices}</td>
                                <td>\${new Date(l.expiresAt).toLocaleDateString()}</td>
                                <td>
                                    \${l.status !== 'suspended' ? 
                                        \`<button class="btn btn-danger" onclick="suspend('\${l.key}')">Suspender</button>
                                         <button class="btn btn-warning" onclick="pause('\${l.key}')">Pausar</button>\` : 
                                        \`<button class="btn btn-success" onclick="resume('\${l.key}')">Reanudar</button>\`
                                    }
                                    <button class="btn btn-primary" onclick="extend('\${l.key}')">+30 días</button>
                                </td>
                            </tr>
                        \`;
                    });
                    
                    html += '</table>';
                    document.getElementById('licensesTable').innerHTML = html;
                } catch (e) { 
                    document.getElementById('licensesTable').innerHTML = '<p style="color: #ef4444;">Error cargando datos</p>';
                    console.error('Error:', e); 
                }
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
                
                alert('✅ Licencia creada');
                loadLicenses();
                loadStats();
                
                // Limpiar formulario
                document.getElementById('newKey').value = 'ADBR-2024-';
                document.getElementById('newClient').value = '';
            }
            
            async function suspend(key) {
                const reason = prompt('¿Por qué suspendes esta licencia?');
                if (!reason) return;
                
                await fetch(\`/admin/licenses/\${key}/suspend\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({reason})
                });
                
                alert('🚫 Licencia suspendida. El bot se detendrá en breve.');
                loadLicenses();
                loadStats();
            }
            
            async function pause(key) {
                await fetch(\`/admin/licenses/\${key}/pause\`, {method: 'POST'});
                alert('⏸️ Licencia pausada');
                loadLicenses();
                loadStats();
            }
            
            async function resume(key) {
                await fetch(\`/admin/licenses/\${key}/resume\`, {method: 'POST'});
                alert('▶️ Licencia reanudada');
                loadLicenses();
                loadStats();
            }
            
            async function extend(key) {
                await fetch(\`/admin/licenses/\${key}/extend\`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({days: 30})
                });
                alert('📅 Licencia extendida 30 días');
                loadLicenses();
            }
            
            // Cargar al inicio
            loadStats();
            loadLicenses();
            
            // Actualizar cada 5 segundos
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
    console.log(`🚀 Servidor activo en puerto ${PORT}`);
});