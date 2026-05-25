;(function (global) {
  function text(value) {
    return String(value == null ? '' : value);
  }

  function makeHeaders(token) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    };
  }

  class MateMountClient {
    constructor(config) {
      const cfg = config && typeof config === 'object' ? config : {};
      this.baseUrl = text(cfg.baseUrl || '').replace(/\/+$/, '') || '';
      this.productId = text(cfg.productId || '').trim();
      this.userId = text(cfg.userId || 'guest').trim();
      this.workspaceId = text(cfg.workspaceId || '').trim();
      this.scopes = Array.isArray(cfg.scopes) ? cfg.scopes : ['chat.read', 'chat.write'];
      this.token = '';
      this.sessionId = '';
      this.expiresAt = 0;
    }

    async initSession() {
      const res = await fetch(`${this.baseUrl}/api/platform/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: this.productId,
          userId: this.userId,
          workspaceId: this.workspaceId,
          scopes: this.scopes,
          metadata: {
            mountedVia: 'mate_mount_sdk',
            mountedAt: Date.now()
          }
        })
      });
      if (!res.ok) {
        throw new Error(`session init failed (${res.status})`);
      }
      const data = await res.json();
      this.token = text(data.token || '');
      this.sessionId = text(data.sessionId || '');
      this.expiresAt = Number(data.expiresAt || 0);
      if (!this.token) throw new Error('session token missing');
      return data;
    }

    async ensureSession() {
      if (!this.token || (this.expiresAt && Date.now() >= this.expiresAt - 30000)) {
        await this.initSession();
      }
      return this.token;
    }

    async validateSession() {
      const token = await this.ensureSession();
      const res = await fetch(`${this.baseUrl}/api/platform/v1/sessions/validate`, {
        headers: makeHeaders(token)
      });
      if (!res.ok) throw new Error(`session validate failed (${res.status})`);
      return res.json();
    }

    async chat(payload) {
      const token = await this.ensureSession();
      const message = text(payload && payload.message);
      if (!message) throw new Error('message is required');

      const res = await fetch(`${this.baseUrl}/api/platform/v1/chat`, {
        method: 'POST',
        headers: makeHeaders(token),
        body: JSON.stringify({
          message,
          chatId: payload && payload.chatId ? payload.chatId : '',
          responseMode: payload && payload.responseMode ? payload.responseMode : 'default',
          attachments: Array.isArray(payload && payload.attachments) ? payload.attachments : []
        })
      });
      const raw = await res.text();
      let data = {};
      try {
        data = JSON.parse(raw || '{}');
      } catch (e) {
        data = { error: raw || 'invalid json response' };
      }
      if (!res.ok) {
        const err = text(data.error || `chat failed (${res.status})`);
        throw new Error(err);
      }
      return data;
    }
  }

  global.MateMountClient = MateMountClient;
})(window);
