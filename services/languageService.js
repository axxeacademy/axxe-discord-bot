const fs = require('fs');
const path = require('path');

class LanguageService {
  constructor() {
    this.localesDir = path.join(__dirname, '..', 'locales');
    this.cache = new Map();
    this.defaultLanguage = 'pt-PT';
  }

  loadLanguageFile(language) {
    if (this.cache.has(language)) {
      return this.cache.get(language);
    }
    const filePath = path.join(this.localesDir, `${language}.json`);
    if (!fs.existsSync(filePath)) {
      if (language !== this.defaultLanguage) {
        // Fallback to default language
        return this.loadLanguageFile(this.defaultLanguage);
      }
      throw new Error(`Language file not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const messages = JSON.parse(content);
    this.cache.set(language, messages);
    return messages;
  }

  getMessage(language, key, variables = {}) {
    const messages = this.loadLanguageFile(language);
    let message = messages[key] || messages[key.toLowerCase()] || '';
    // Replace variables in message
    Object.entries(variables).forEach(([varKey, value]) => {
      const regex = new RegExp(`{${varKey}}`, 'g');
      message = message.replace(regex, value);
    });
    return message;
  }
}

module.exports = new LanguageService();
