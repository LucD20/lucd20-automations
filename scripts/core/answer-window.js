const { ApplicationV2 } = foundry.applications.api;

/**
 * An ApplicationV2 that resolves wait() with a value when it is answered or closed.
 * Documents are handed over with setup() after construction, not through the
 * options (Foundry copies window options).
 */
export class AnswerWindow extends ApplicationV2 {
  static wait(data) {
    return new Promise(resolve => {
      const app = new this();
      app.setup(data);
      app._resolve = resolve;
      app.render({ force: true });
    });
  }

  setup() {}

  answer(value) {
    if (this._answered) return;
    this._answered = true;
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(value);
    this.close();
  }

  async _onClose(options) {
    await super._onClose?.(options);
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(null);
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }
}

