import { App, Modal } from 'obsidian';

export class MarkerOkayCancelDialog extends Modal {
  private submitted = false;
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
      this.submit(true);
      this.close();
    });
    const noButton = buttonContainer.createEl('button', {
      text: 'Cancel',
    });
    noButton.addEventListener('click', () => {
      this.result = false;
      this.submit(false);
      this.close();
    });
  }

  onClose() {
    this.submit(false);
    const { contentEl } = this;
    contentEl.empty();
  }

  private submit(result: boolean) {
    if (this.submitted) return;
    this.submitted = true;
    this.onSubmit(result);
  }
}
