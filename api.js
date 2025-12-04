class HNBlockAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://hn.gordyf.com';
    this.timeout = 10000; // 10 seconds
  }

  async request(endpoint, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...options.headers
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;

        // Try to parse error body
        try {
          const errorData = await response.json();
          error.message = errorData.error || error.message;
          error.code = errorData.code;
        } catch (e) {
          // Use default error message if JSON parsing fails
        }

        throw error;
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort/timeout
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Request timeout');
        timeoutError.isNetworkError = true;
        throw timeoutError;
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        error.isNetworkError = true;
      }

      throw error;
    }
  }

  async getBlockedUsers() {
    const response = await this.request('/blocked-users');
    return response.users || [];
  }

  async blockUser(username) {
    try {
      const response = await this.request('/blocked-users', {
        method: 'POST',
        body: JSON.stringify({ username })
      });
      return response;
    } catch (error) {
      // 409 Conflict means user already blocked - treat as success
      if (error.status === 409) {
        return { username, message: 'User already blocked', alreadyExists: true };
      }
      throw error;
    }
  }

  async unblockUser(username) {
    try {
      const response = await this.request(`/blocked-users/${encodeURIComponent(username)}`, {
        method: 'DELETE'
      });
      return response;
    } catch (error) {
      // 404 Not Found means user not in list - treat as success (idempotent)
      if (error.status === 404) {
        return { username, message: 'User not in blocked list', alreadyUnblocked: true };
      }
      throw error;
    }
  }

  async checkConnection() {
    try {
      await this.getBlockedUsers();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        isAuthError: this.isAuthError(error),
        isNetworkError: this.isNetworkError(error)
      };
    }
  }

  isNetworkError(error) {
    return error.isNetworkError === true ||
           error.name === 'AbortError' ||
           (error instanceof TypeError && error.message.includes('fetch'));
  }

  isAuthError(error) {
    return error.status === 401;
  }

  isServerError(error) {
    return error.status >= 500 && error.status < 600;
  }

  isRetryableError(error) {
    return this.isNetworkError(error) || this.isServerError(error);
  }
}
