<script setup>
import {t} from '../i18n.js';

import { ref, computed, reactive, onMounted, watch } from 'vue'
import TaskEditor from './TaskEditor.vue'

const props = defineProps({
  device: {
    type: Object,
    required: true
  },
  accountName: { type: String, default: '' }
})

const emit = defineEmits(['send-cmd', 'update-remark'])

const isV2 = computed(() => props.device.version === 'v2')

// Helper to check if plug exists
const getPlug = (index) => props.device[`plug_${index}`]

const togglePlug = (index) => {
  if (isV2.value) {
    const current = props.device[`socket_${index}`]
    const newState = current === 1 ? 0 : 1
    emit('send-cmd', {
      mac: props.device.mac,
      payload: `set socket ${props.device.mac} ${index} ${newState}`
    })
    return
  }
  const plug = getPlug(index)
  if (!plug) return
  
  const cmd = {
    mac: props.device.mac,
    [`plug_${index}`]: {
      on: plug.on === 1 ? 0 : 1
    }
  }
  emit('send-cmd', cmd)
}

const updatePlugName = (index, newName) => {
  const cmd = {
    mac: props.device.mac,
    [`plug_${index}`]: {
      setting: {
        name: newName
      }
    }
  }
  emit('send-cmd', cmd)
}

// Local rename state
const editingPlug = ref(-1)
const tempName = ref('')
const remarks = reactive({}) // Local remarks storage

// Load remarks from localStorage
const loadRemarks = () => {
  // Clear previous remarks
  Object.keys(remarks).forEach(key => delete remarks[key])
  
  const id = props.device.mac
  const legacyIDs = [id, id.toUpperCase(), id.match(/../g)?.join(':'), id.match(/../g)?.join(':').toUpperCase()]
  const saved = props.accountName
    ? localStorage.getItem(`phicomm_remarks_${props.accountName}_${id}`)
    : legacyIDs.map(mac => localStorage.getItem(`ztc1_remarks_${mac}`)).find(Boolean)
  if (saved) {
    try { Object.assign(remarks, JSON.parse(saved)) } catch { /* Ignore corrupt local remarks. */ }
  }
}

// Watch for device changes to reload remarks
watch(() => props.device.mac, () => {
  loadRemarks()
  editingPlug.value = -1 // Reset editing state when switching devices
})

onMounted(() => {
  loadRemarks()
  
  if (!isV2.value) {
    // Query status for locks (v1 only)
    emit('send-cmd', {
        mac: props.device.mac,
        child_lock: null,
        led_lock: null
    })
  }
})

const startEdit = (index) => {
  if (isV2.value) {
    editingPlug.value = index
    tempName.value = remarks[index] || getV2SocketName(index)
    return
  }
  const plug = getPlug(index)
  if (!plug) return
  editingPlug.value = index
  // Prefer local remark, then device name
  tempName.value = remarks[index] || plug.name
}

const saveV2Edit = (index) => {
  if (editingPlug.value === index) {
    remarks[index] = tempName.value
    localStorage.setItem((props.accountName ? `phicomm_remarks_${props.accountName}_${props.device.mac}` : `ztc1_remarks_${props.device.mac}`), JSON.stringify(remarks))
    editingPlug.value = -1
  }
}

const saveEdit = (index) => {
  if (editingPlug.value === index) {
    // 1. Send name to device
    updatePlugName(index, tempName.value)
    
    // 2. Save locally
    remarks[index] = tempName.value
    localStorage.setItem((props.accountName ? `phicomm_remarks_${props.accountName}_${props.device.mac}` : `ztc1_remarks_${props.device.mac}`), JSON.stringify(remarks))
    
    editingPlug.value = -1
  }
}

// Timer Logic
const expandedTaskPlug = ref(-1)

const toggleTaskView = (index) => {
  if (expandedTaskPlug.value === index) {
    expandedTaskPlug.value = -1
  } else {
    expandedTaskPlug.value = index
  }
}

const updateTask = (plugIndex, taskIndex, taskData) => {
  // taskData should contain hour, minute, repeat, action, on
  // Build the command
  const cmd = {
    mac: props.device.mac,
    [`plug_${plugIndex}`]: {
      setting: {
        [`task_${taskIndex}`]: taskData
      }
    }
  }
  emit('send-cmd', cmd)
}

const getTask = (plugIndex, taskIndex) => {
  const plug = getPlug(plugIndex)
  if (!plug || !plug.setting) return null
  return plug.setting[`task_${taskIndex}`]
}

const bitToDays = (bits) => {
  if (bits === 0) return t('p.d736c7e45952')
  if (bits === 127) return t('p.eea1694c235b')
  const days = [t('p.51a75f4634df'),t('p.084b42f6e95e'),t('p.a4c3313deb18'),t('p.754a9d5828d5'),t('p.c9b87f516a38'),t('p.de07b5383874'),t('p.85217f7aff77')]
  let res = []
  for(let i=0; i<7; i++) {
    if ((bits >> i) & 1) res.push(days[i])
  }
  return t('p.5c553ec3f6db') + res.join('')
}

// Advanced Settings
const deviceSettings = reactive({
    mqtt_uri: '',
    mqtt_port: 1883,
    mqtt_user: '',
    mqtt_password: '',
    ota: ''
})

watch(() => props.device.setting, (val) => {
    if(val) {
        // Only update if not currently editing? Or just sync.
        // Simple sync
        if(val.mqtt_uri !== undefined) deviceSettings.mqtt_uri = val.mqtt_uri
        if(val.mqtt_port !== undefined) deviceSettings.mqtt_port = val.mqtt_port
        if(val.mqtt_user !== undefined) deviceSettings.mqtt_user = val.mqtt_user
        // password might be hidden or not returned
        if(val.ota !== undefined) deviceSettings.ota = val.ota
    }
}, { deep: true, immediate: true })

const querySettings = () => {
    emit('send-cmd', { mac: props.device.mac, setting: { mqtt_uri: null } })
}

const saveMqttSettings = () => {
   emit('send-cmd', { 
       mac: props.device.mac, 
       setting: { 
           mqtt_uri: deviceSettings.mqtt_uri,
           mqtt_port: Number(deviceSettings.mqtt_port),
           mqtt_user: deviceSettings.mqtt_user,
           mqtt_password: deviceSettings.mqtt_password
       } 
   })
}

const performOta = () => {
   if(!deviceSettings.ota) return
   // Ensure URL format is correct per docs (no @, no redirect)
   emit('send-cmd', { mac: props.device.mac, setting: { ota: deviceSettings.ota } })
}


const formatPower = computed(() => {
  if (isV2.value) {
    return props.device.power || '0.0'
  }
  return props.device.power || '0.0'
})

const monthlyKwh = computed(() => {
  const power = parseFloat(props.device.power) || 0
  return (power * 24 * 30 / 1000).toFixed(1)
})

const formatTime = (seconds) => {
  if (!seconds) return '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}h ${m}m ${s}s`
}

// Device Name Editing
const deviceNameEditing = ref(false)
const tempDeviceName = ref('')

const startDeviceEdit = () => {
  tempDeviceName.value = props.device.name || props.device.mac
  deviceNameEditing.value = true
}

const saveDeviceName = () => {
  const cmd = {
    mac: props.device.mac,
    setting: {
      name: tempDeviceName.value
    }
  }
  emit('send-cmd', cmd)
  deviceNameEditing.value = false
}

const toggleChildLock = () => {
    if (isV2.value) {
      const current = props.device.childLock === 1 ? 0 : 1
      emit('send-cmd', {
        mac: props.device.mac,
        payload: `set childLock ${props.device.mac} ${current}`
      })
      return
    }
    emit('send-cmd', {
        mac: props.device.mac,
        child_lock: props.device.child_lock === 1 ? 0 : 1
    })
}

const toggleLedLock = () => {
    if (isV2.value) {
      const current = props.device.led === 1 ? 0 : 1
      emit('send-cmd', {
        mac: props.device.mac,
        payload: `set led ${props.device.mac} ${current}`
      })
      return
    }
    emit('send-cmd', {
        mac: props.device.mac,
        led_lock: props.device.led_lock === 1 ? 0 : 1
    })
}

// v2: total socket toggle
const toggleTotalSocket = () => {
    const current = props.device.total_socket === 1 ? 0 : 1
    emit('send-cmd', {
      mac: props.device.mac,
      payload: `set total_socket ${props.device.mac} ${current}`
    })
}

// v2: reboot
const rebootDevice = () => {
    if (!confirm(t('p.8065066f47cc'))) return
    emit('send-cmd', {
      mac: props.device.mac,
      payload: `reboot ${props.device.mac}`
    })
}

// v2: soft reboot
const softRebootDevice = () => {
    if (!confirm(t('p.882d368a4b21'))) return
    emit('send-cmd', {
      mac: props.device.mac,
      payload: `soft_reboot ${props.device.mac}`
    })
}

// v2 helpers
const getV2SocketState = (index) => {
  return props.device[`socket_${index}`]
}

const getV2SocketName = (index) => {
  return props.device.entityNames?.[`socket_${index}`] || t('p.06e5bd727440',{v0:(index + 1)})
}

// Layout Control
const gridLayout = ref('auto') // auto, 1x6, 2x3, 3x2

const gridStyle = computed(() => {
    switch(gridLayout.value) {
        case '1x6': return { gridTemplateColumns: 'repeat(6, 1fr)' }
        case '2x3': return { gridTemplateColumns: 'repeat(3, 1fr)' }
        case '3x2': return { gridTemplateColumns: 'repeat(2, 1fr)' }
        default: return { gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }
    }
})

</script>

<template>
  <div class="device-control">
    <div class="device-header">
      <div class="info-row">
        <span>MAC: {{ device.mac }}</span>
        <span>
          <template v-if="isV2">
            {{ device.deviceName || device.mac }}
            <span class="version-tag">v2</span>
          </template>
          <template v-else-if="!deviceNameEditing">
            {{ device.name || 'tc1(a1)' }} <button @click="startDeviceEdit" class="icon-btn">✎</button>
          </template>
          <template v-else>
            <input v-model="tempDeviceName" @keyup.enter="saveDeviceName" class="edit-input">
            <button @click="saveDeviceName" class="icon-btn">✓</button>
          </template>
        </span>
      </div>
      <div class="stats-row">
        <div class="stat">
          <label>{{t('p.3993e09bcbbe')}}</label>
          <div class="value power-value"><span class="power-main">{{ formatPower }} W</span><span class="monthly-kwh">≈{{ monthlyKwh }}{{t('p.9446ab9be656')}}</span></div>
        </div>
        <template v-if="isV2">
          <div class="stat">
            <label>{{t('p.5986e9d976e0')}}</label>
            <div class="value">{{ device.startupTime || '-' }}</div>
          </div>
          <div class="stat">
            <label>{{t('p.86f74f625256')}}</label>
            <div class="value">{{ device.powerConsumption || '0' }} kWh</div>
          </div>
          <div class="stat">
            <label>{{t('p.7fb9608d13ad')}}</label>
            <div class="value">{{ device.powerConsumptionToday || '0' }} kWh</div>
          </div>
          <div class="stat">
            <label>{{t('p.2c6926fcc328')}}</label>
            <div class="value">{{ device.powerConsumptionYesterday || '0' }} kWh</div>
          </div>
        </template>
        <template v-else>
          <div class="stat">
            <label>{{t('p.5986e9d976e0')}}</label>
            <div class="value">{{ formatTime(device.total_time) }}</div>
          </div>
        </template>
        
        <div class="stat-controls">
            <div class="layout-selector">
                <select v-model="gridLayout" :title="t('p.5c39c59738ac')">
                    <option value="auto">{{t('p.075737afad97')}}</option>
                    <option value="1x6">{{t('p.c90c4d7470a5')}}</option>
                    <option value="2x3">{{t('p.9701668e10bc')}}</option>
                    <option value="3x2">{{t('p.9d89a5170d4b')}}</option>
                </select>
            </div>
            <template v-if="isV2">
              <button 
                class="toggle-chip" 
                :class="{ active: device.total_socket === 1 }"
                @click="toggleTotalSocket"
                :title="t('p.f211affe535c')"
              >
                {{t('p.f836b418cd28')}}
              </button>
              <button 
                class="toggle-chip" 
                :class="{ active: device.childLock === 1 }"
                @click="toggleChildLock"
                :title="t('p.0f68010bc429')"
              >
                {{t('p.eac4629f0200')}}
              </button>
              <button 
                class="toggle-chip" 
                :class="{ active: device.led === 1 }"
                @click="toggleLedLock"
                :title="t('p.39e74a45bc34')"
              >
                {{t('device.led')}}
              </button>
              <button 
                class="toggle-chip danger" 
                @click="softRebootDevice"
                :title="t('p.ad340b2bea4d')"
              >
                {{t('p.5ddd1cfa72b6')}}
              </button>
              <button 
                class="toggle-chip danger" 
                @click="rebootDevice"
                :title="t('p.aa6c5b1ec576')"
              >
                {{t('p.230c7a3f2486')}}
              </button>
            </template>
            <template v-else>
              <button 
                class="toggle-chip" 
                :class="{ active: device.child_lock === 1 }"
                @click="toggleChildLock"
                :title="t('p.21d53244825f')"
              >
                {{t('p.eac4629f0200')}}
              </button>
              <button 
                class="toggle-chip" 
                :class="{ active: device.led_lock === 1 }"
                @click="toggleLedLock"
                :title="t('p.09148812bd7d')"
              >
                {{t('p.1c00917b4e2d')}}
              </button>
            </template>
        </div>
      </div>
    </div>

    <!-- v2 plugs grid -->
    <div v-if="isV2" class="plugs-grid" :style="gridStyle">
      <div v-for="i in 6" :key="i-1" class="plug-item card" :class="{ on: getV2SocketState(i-1) === 1 }">
        <div class="plug-header">
          <div v-if="editingPlug !== i-1" class="plug-name" @click="startEdit(i-1)">
            {{ remarks[i-1] || getV2SocketName(i-1) }}
            <span v-if="remarks[i-1]" class="remark-indicator" :title="t('p.ade80771a6d8')">*</span>
          </div>
          <input v-else 
            v-model="tempName" 
            @blur="saveV2Edit(i-1)" 
            @keyup.enter="saveV2Edit(i-1)"
            class="edit-input"
            autoFocus
          >
        </div>
        <div class="plug-body">
          <button 
            class="switch-btn" 
            :class="{ active: getV2SocketState(i-1) === 1 }"
            @click="togglePlug(i-1)"
          >
            {{ t(getV2SocketState(i-1) === 1 ? 'state.on' : 'state.off') }}
          </button>
        </div>
      </div>
    </div>

    <!-- v1 plugs grid -->
    <div v-else class="plugs-grid" :style="gridStyle">
      <div v-for="i in 6" :key="i-1" class="plug-item card" :class="{ on: getPlug(i-1)?.on === 1 }">
        <div class="plug-header">
          <template v-if="getPlug(i-1)">
            <div v-if="editingPlug !== i-1" class="plug-name" @click="startEdit(i-1)">
              {{ remarks[i-1] || getPlug(i-1).name || t('p.06e5bd727440',{v0:(i)}) }}
              <span v-if="remarks[i-1]" class="remark-indicator" :title="t('p.ade80771a6d8')">*</span>
            </div>
            <input v-else 
              v-model="tempName" 
              @blur="saveEdit(i-1)" 
              @keyup.enter="saveEdit(i-1)"
              class="edit-input"
              autoFocus
            >
          </template>
          <template v-else>
            <div class="plug-name">{{t('p.c6613ed29291')}} {{ i }} {{t('p.944fa22ceebd')}}</div>
          </template>
        </div>
        
        <div class="plug-body">
          <button 
            class="switch-btn" 
            :class="{ active: getPlug(i-1)?.on === 1 }"
            @click="togglePlug(i-1)"
            :disabled="!getPlug(i-1)"
          >
            {{ t(getPlug(i-1)?.on === 1 ? 'state.on' : 'state.off') }}
          </button>
          
          <div class="plug-actions">
            <button class="text-btn" @click="toggleTaskView(i-1)">
              {{t('p.6a2b5eb8d433')}} {{ expandedTaskPlug === i-1 ? '▲' : '▼' }}
            </button>
          </div>
        </div>

        <div v-if="expandedTaskPlug === i-1" class="task-list">
             <div v-for="t in 5" :key="t-1" class="task-item">
                <TaskEditor 
                    :task="getTask(i-1, t-1)" 
                    :index="t-1"
                    @save="data => updateTask(i-1, t-1, data)" 
                />
             </div>
        </div>
      </div>
    </div>

    <!-- 简化版，后续可以添加更多设置 -->
    <details v-if="!isV2" class="advanced-settings">
      <summary>{{t('p.90a494e9e017')}}</summary>
      <div class="settings-content">
        <div class="settings-group">
            <h4>{{t('p.7ee7b8b10c92')}} <button @click="querySettings" class="small-btn">{{t('p.2d785d603990')}}</button></h4>
            <div class="form-row">
                <label>{{t('p.81a3373e6926')}} <input v-model="deviceSettings.mqtt_uri" placeholder="www.mqtt.com"></label>
            </div>
            <div class="form-row">
                <label>{{t('p.e78a09b2f2d3')}} <input v-model="deviceSettings.mqtt_port" type="number"></label>
            </div>
            <div class="form-row">
                <label>{{t('p.0f29c8fea48e')}} <input v-model="deviceSettings.mqtt_user"></label>
            </div>
            <div class="form-row">
                <label>{{t('p.08b7e701ee4e')}} <input v-model="deviceSettings.mqtt_password" type="password"></label>
            </div>
            <button @click="saveMqttSettings" class="primary-btn">{{t('p.ecb0f19f9d79')}}</button>
        </div>

        <div class="settings-group">
            <h4>{{t('p.ac7045ab1b77')}}</h4>
            <div class="form-row">
                <label>URL: <input v-model="deviceSettings.ota" placeholder="http://.../fw.bin"></label>
            </div>
            <button @click="performOta" class="primary-btn">{{t('p.d107bae3c1bb')}}</button>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.device-control {
  padding: 10px;
}
.device-header {
  margin-bottom: 20px;
  background: var(--bg-card);
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 4px var(--shadow-color);
}
.info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 15px;
  font-weight: bold;
  flex-wrap: wrap; /* Allow wrapping */
  gap: 10px;
}
.stats-row {
  display: flex;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap; /* Allow wrapping */
}
.stat-controls {
    display: flex;
    gap: 10px;
    margin-left: auto;
    flex-wrap: wrap;
}

/* Mobile optimizations */
@media (max-width: 600px) {
    .stat-controls {
        margin-left: 0;
        width: 100%;
        margin-top: 10px;
        justify-content: space-between;
    }
    .layout-selector {
        width: 100%;
        margin-bottom: 10px;
    }
    .layout-selector select {
        width: 100%;
    }
    .stat {
        flex: 1;
        min-width: 80px;
    }
}
.layout-selector {
    margin-right: 10px;
}
.layout-selector select {
    padding: 5px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    background: var(--bg-card);
}
.toggle-chip {
    padding: 6px 12px;
    border-radius: 16px;
    border: 1px solid var(--border-color);
    background: var(--chip-bg);
    cursor: pointer;
    font-size: 0.85em;
    transition: all 0.2s;
    color: var(--chip-color);
}
.toggle-chip.active {
    background: var(--chip-active-bg);
    color: #1976d2;
    border-color: #1976d2;
}
.toggle-chip.danger {
    color: var(--chip-danger-color);
    border-color: #e57373;
}
.toggle-chip.danger:hover {
    background: var(--chip-danger-hover);
}
.version-tag {
    font-size: 0.7em;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--chip-active-bg);
    color: #1976d2;
    margin-left: 6px;
    vertical-align: middle;
}
.stat label {
  font-size: 0.8em;
  color: var(--text-secondary);
  display: block;
}
.stat .value {
  font-size: 1.2em;
  font-weight: bold;
}
.power-value {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
}
.power-main {
  white-space: nowrap;
  margin-right: 4px;
}
.monthly-kwh {
  font-size: 0.55em;
  font-weight: normal;
  color: var(--text-muted);
  white-space: nowrap;
}

.plugs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
}
.plug-item {
  background: var(--bg-card);
  border-radius: 8px;
  padding: 15px;
  text-align: center;
  transition: all 0.3s ease;
  border: 2px solid transparent;
}
.plug-item.on {
  border-color: var(--card-on-border);
  background: var(--card-on-bg);
}
.plug-name {
  margin-bottom: 15px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 1px dashed var(--border-color);
  display: inline-block;
  color: var(--text-primary);
}
.switch-btn {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: none;
  background: var(--switch-bg);
  color: var(--switch-color);
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}
.switch-btn.active {
  background: #4caf50;
  color: white;
  box-shadow: 0 0 10px rgba(76, 175, 80, 0.5);
}

.edit-input {
  width: 100%;
  padding: 4px;
  background: var(--bg-input);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}
.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
}
.card {
  box-shadow: 0 2px 4px var(--shadow-color);
}

.advanced-settings {
  background: var(--bg-card);
  padding: 10px;
  border-radius: 8px;
  margin-top: 20px;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}
.settings-content {
    padding: 10px;
}
.settings-group {
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-light);
}
.form-row {
    margin-bottom: 10px;
}
.form-row label {
    display: flex;
    flex-direction: column;
    font-size: 0.9em; 
    color: var(--text-secondary);
}
.form-row input {
    padding: 6px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    margin-top: 4px;
    background: var(--bg-input);
    color: var(--text-primary);
}
.small-btn {
    font-size: 0.8em;
    padding: 2px 8px;
    background: var(--bg-secondary);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-left: 10px;
    color: var(--text-primary);
}
.primary-btn {
    background: #2196f3;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
}
.text-btn {
    border: none;
    background: none;
    color: #2196f3;
    cursor: pointer;
    font-size: 0.8em;
    margin-top: 5px;
}
</style>
