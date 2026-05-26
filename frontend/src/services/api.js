import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.response.use(
  r => r.data,
  err => Promise.reject(err.response?.data || err)
);

export const agentsApi = {
  list: () => api.get('/agents'),
  get: id => api.get(`/agents/${id}`),
  create: data => api.post('/agents', data),
  update: (id, data) => api.put(`/agents/${id}`, data),
  delete: id => api.delete(`/agents/${id}`),
  getMemory: id => api.get(`/agents/${id}/memory`),
  setMemory: (id, data) => api.post(`/agents/${id}/memory`, data),
  deleteMemory: (id, key) => api.delete(`/agents/${id}/memory/${key}`)
};

export const workflowsApi = {
  list: (params) => api.get('/workflows', { params }),
  get: id => api.get(`/workflows/${id}`),
  create: data => api.post('/workflows', data),
  update: (id, data) => api.put(`/workflows/${id}`, data),
  delete: id => api.delete(`/workflows/${id}`),
  run: (id, input) => api.post(`/workflows/${id}/run`, { input }),
  getRuns: id => api.get(`/workflows/${id}/runs`),
  clone: (id, name) => api.post(`/workflows/${id}/clone`, { name })
};

export const runsApi = {
  list: (params) => api.get('/runs', { params }),
  get: id => api.get(`/runs/${id}`),
  getLogs: (id, params) => api.get(`/runs/${id}/logs`, { params }),
  getStats: () => api.get('/runs/stats/summary'),
  create: (data) => api.post('/runs', data),
  addLog: (id, data) => api.post(`/runs/${id}/log`, data),
  update: (id, data) => api.patch(`/runs/${id}`, data),
};

export const channelsApi = {
  list: () => api.get('/channels'),
  get: id => api.get(`/channels/${id}`),
  getStatus: id => api.get(`/channels/${id}/status`),
  create: data => api.post('/channels', data),
  update: (id, data) => api.put(`/channels/${id}`, data),
  delete: id => api.delete(`/channels/${id}`),
  getMessages: (id, params) => api.get(`/channels/${id}/messages`, { params }),
  getAllMessages: (params) => api.get('/channels/messages/all', { params })
};

export default api;
