import { useState, useEffect, useRef } from 'react';
import { channelsApi } from '../services/api.js';
import { getSocket } from '../services/socket.js';
import { MessageSquare, ArrowUp, ArrowDown } from 'lucide-react';

export default function Messages() {
  const [messages, setMessages] = useState([]);
  const [filter, setFilter] = useState('all');
  const bottomRef = useRef(null);

  const load = async () => {
    try {
      const data = await channelsApi.getAllMessages({ limit: 100 });
      setMessages(data.reverse());
    } catch (e) {}
  };

  useEffect(() => {
    load();
    const socket = getSocket();
    socket.on('message:new', (msg) => {
      setMessages(prev => [...prev, { ...msg, metadata: {} }]);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
    return () => socket.off('message:new');
  }, []);

  const filtered = filter === 'all' ? messages : messages.filter(m => m.channel === filter);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
          <p className="text-gray-500 text-sm mt-1">All incoming and outgoing channel messages</p>
        </div>
        <div className="flex gap-2">
          {['all', 'telegram'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
                filter === f ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900'
              }`}>{f}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <MessageSquare size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No messages yet. Send a message to your Telegram bot to get started.</p>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100 max-h-[calc(100vh-200px)] overflow-y-auto">
          {filtered.map((msg, i) => (
            <div key={msg.id || i} className={`flex items-start gap-3 p-4 ${
              msg.direction === 'outgoing' ? 'bg-pink-50/50' : ''
            }`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                msg.direction === 'incoming' ? 'bg-gray-200' : 'bg-pink-100'
              }`}>
                {msg.direction === 'incoming'
                  ? <ArrowDown size={12} className="text-gray-500" />
                  : <ArrowUp size={12} className="text-brand-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-700">{msg.sender || 'user'}</span>
                  <span className="badge badge-gray text-xs">{msg.channel}</span>
                  {msg.chat_id && <span className="text-xs text-gray-400">chat:{msg.chat_id}</span>}
                  <span className="text-xs text-gray-400 ml-auto">{new Date(msg.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
