import { App, Modal } from 'obsidian';

export class MarkerOkayCancelDialog extends Modal {
  result: boolean;
  title: string;
  message: string;
  onSubmit: (result: boolean) => void;

  constructor(
    app: App,
    title: string,
    message: string,
    onSubmit: (result: boolean) => void
  ) {
    super(app);
    this.onSubmit = onSubmit;
    this.title = title;
    this.message = message;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', {
      text: this.message,
    });

    const buttonContainer = contentEl.createEl('div', {
      attr: { class: 'modal-button-container' },
    });
    const yesButton = buttonContainer.createEl('button', {
      text: 'Okay',
      attr: { class: 'mod-cta' },
    });
    yesButton.addEventListener('click', () => {
      this.result = true;
      this.onSubmit(true);
      this.close();
    });
    const noButton = buttonContainer.createEl('button', {
      text: 'Cancel',
    });
    noButton.addEventListener('click', () => {
      this.result = false;
      this.onSubmit(false);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class MarkerNumberInputDialog extends Modal {
  private onSubmit: (result: number | null) => void;
  private title: string;
  private message: string;
  private defaultValue: number;

  constructor(
    app: App,
    title: string,
    message: string,
    defaultValue: number,
    onSubmit: (result: number | null) => void
  ) {
    super(app);
    this.title = title;
    this.message = message;
    this.defaultValue = defaultValue;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', { text: this.message });

    const input = contentEl.createEl('input', {
      attr: {
        type: 'number',
        value: String(this.defaultValue),
        min: '1',
        style: 'width: 100%; margin-bottom: 1em;',
      },
    }) as HTMLInputElement;
    input.focus();
    input.select();

    const buttonContainer = contentEl.createEl('div', {
      attr: { class: 'modal-button-container' },
    });
    const okButton = buttonContainer.createEl('button', {
      text: 'Confirm',
      attr: { class: 'mod-cta' },
    });
    okButton.addEventListener('click', () => {
      const num = parseInt(input.value);
      this.onSubmit(isNaN(num) ? 1 : num);
      this.close();
    });
    const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => {
      this.onSubmit(null);
      this.close();
    });

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') okButton.click();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class MarkerSupportedLangsDialog extends Modal {
  title: string;
  message: string;
  link: string;
  linkText: string;

  constructor(app: App) {
    super(app);
    this.title = 'Supported Languages';
    this.message =
      'To see the supported languages, please visit the following link:';
    this.link =
      'https://github.com/VikParuchuri/surya/blob/master/surya/languages.py';
    this.linkText = 'Supported Languages (VikParuchuri/surya)';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', {
      text: this.message,
    });
    contentEl.createEl('a', {
      text: this.linkText,
      attr: { href: this.link },
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
