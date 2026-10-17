import {
  App,
  ButtonComponent,
  DropdownComponent,
  ExtraButtonComponent,
  Modal,
  TextAreaComponent,
  TextComponent,
  ToggleComponent,
  debounce,
} from 'obsidian';
import { MarkerSettings } from './settings';
import { MarkerOkayCancelDialog } from './modals';
import {
  PROMPT_RULE_CONDITIONS,
  PromptRule,
  PromptRuleCondition,
} from './utils/promptUtils';

// Describes which prompt the editor works on and how it is assembled
export interface PromptEditorConfig {
  title: string;
  description: string;
  introKey: 'openaiSystemPrompt' | 'cliSystemPrompt';
  rulesKey: 'openaiPromptRules' | 'cliPromptRules';
  defaultIntro: string;
  getDefaultRules: () => PromptRule[];
  // Whether rules can be limited to conversions with or without image extraction
  showConditions: boolean;
  buildPreview: (settings: MarkerSettings) => string;
}

export class PromptEditorModal extends Modal {
  private config: PromptEditorConfig;
  private settings: MarkerSettings;
  private saveSettings: () => Promise<void>;
  private onCloseCallback?: () => void;
  private rulesEl: HTMLElement;
  private previewEl: HTMLElement;
  private debouncedSave = debounce(() => this.save(), 500, true);

  constructor(
    app: App,
    config: PromptEditorConfig,
    settings: MarkerSettings,
    saveSettings: () => Promise<void>,
    onCloseCallback?: () => void
  ) {
    super(app);
    this.config = config;
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.onCloseCallback = onCloseCallback;
  }

  private get rules(): PromptRule[] {
    const { rulesKey } = this.config;
    if (!this.settings[rulesKey]) {
      this.settings[rulesKey] = this.config.getDefaultRules();
    }
    return this.settings[rulesKey] as PromptRule[];
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('marker-prompt-modal');
    contentEl.empty();

    contentEl.createEl('h2', { text: this.config.title });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: this.config.description,
    });

    contentEl.createEl('h3', { text: 'Base instructions' });
    const intro = new TextAreaComponent(contentEl)
      .setValue(this.settings[this.config.introKey] ?? '')
      .setPlaceholder(this.config.defaultIntro)
      .onChange((value) => {
        this.settings[this.config.introKey] = value;
        this.changed();
      });
    intro.inputEl.addClass('marker-prompt-intro');
    intro.inputEl.rows = 3;

    const rulesHeader = contentEl.createDiv({ cls: 'marker-prompt-toolbar' });
    rulesHeader.createEl('h3', { text: 'Rules' });
    const actions = rulesHeader.createDiv({ cls: 'marker-prompt-actions' });
    new ButtonComponent(actions)
      .setButtonText('Reset to defaults')
      .onClick(() => this.confirmReset());
    new ButtonComponent(actions)
      .setButtonText('Add rule')
      .setCta()
      .onClick(() => this.addRule());

    this.rulesEl = contentEl.createDiv({ cls: 'marker-prompt-rules' });
    this.renderRules();

    const previewDetails = contentEl.createEl('details', {
      cls: 'marker-prompt-preview',
    });
    previewDetails.createEl('summary', {
      text: 'Preview of the full prompt',
    });
    this.previewEl = previewDetails.createEl('pre');
    this.renderPreview();
  }

  onClose() {
    this.debouncedSave.cancel();
    this.save();
    this.contentEl.empty();
    this.onCloseCallback?.();
  }

  private renderRules() {
    this.rulesEl.empty();

    if (this.rules.length === 0) {
      this.rulesEl.createEl('p', {
        cls: 'marker-prompt-empty',
        text: 'No rules yet. Add one or reset to the defaults.',
      });
      return;
    }

    this.rules.forEach((rule, index) => this.renderRule(rule, index));
  }

  private renderRule(rule: PromptRule, index: number): TextComponent {
    const card = this.rulesEl.createDiv({ cls: 'marker-prompt-rule' });
    card.toggleClass('is-disabled', !rule.enabled);

    const header = card.createDiv({ cls: 'marker-prompt-rule-header' });

    new ToggleComponent(header)
      .setValue(rule.enabled)
      .setTooltip('Enable rule')
      .onChange((value) => {
        rule.enabled = value;
        card.toggleClass('is-disabled', !value);
        this.changed();
      });

    const nameInput = new TextComponent(header)
      .setPlaceholder('Rule name')
      .setValue(rule.name)
      .onChange((value) => {
        rule.name = value;
        this.changed();
      });
    nameInput.inputEl.addClass('marker-prompt-rule-name');

    if (this.config.showConditions) {
      const conditionDropdown = new DropdownComponent(header);
      PROMPT_RULE_CONDITIONS.forEach((condition) =>
        conditionDropdown.addOption(condition.value, condition.label)
      );
      conditionDropdown
        .setValue(rule.condition ?? 'always')
        .onChange((value) => {
          rule.condition = value as PromptRuleCondition;
          this.changed();
        });
    }

    new ExtraButtonComponent(header)
      .setIcon('arrow-up')
      .setTooltip('Move up')
      .setDisabled(index === 0)
      .onClick(() => this.moveRule(index, -1));
    new ExtraButtonComponent(header)
      .setIcon('arrow-down')
      .setTooltip('Move down')
      .setDisabled(index === this.rules.length - 1)
      .onClick(() => this.moveRule(index, 1));
    new ExtraButtonComponent(header)
      .setIcon('trash-2')
      .setTooltip('Delete rule')
      .onClick(() => {
        this.rules.splice(index, 1);
        this.renderRules();
        this.changed();
      });

    const content = new TextAreaComponent(card)
      .setPlaceholder('- One instruction per bullet point')
      .setValue(rule.content);
    content.inputEl.addClass('marker-prompt-rule-content');
    content.inputEl.rows = 2;
    // Grow with the content, including lines that wrap
    const fitContent = () => {
      const input = content.inputEl;
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight + 2}px`;
    };
    requestAnimationFrame(fitContent);
    content.onChange((value) => {
      rule.content = value;
      fitContent();
      this.changed();
    });

    // Continue the bullet list when pressing enter at the end of a bullet
    content.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      const input = content.inputEl;
      const lineStart =
        input.value.lastIndexOf('\n', input.selectionStart - 1) + 1;
      const line = input.value.slice(lineStart, input.selectionStart);
      const bullet = line.match(/^(\s*[-*] )/);
      if (!bullet || input.selectionStart !== input.selectionEnd) return;

      event.preventDefault();
      if (line.trim() === bullet[1].trim()) {
        // Enter on an empty bullet removes it, like in the editor
        input.setRangeText('', lineStart, input.selectionStart, 'end');
      } else {
        input.setRangeText(
          `\n${bullet[1]}`,
          input.selectionStart,
          input.selectionEnd,
          'end'
        );
      }
      input.dispatchEvent(new Event('input'));
    });

    return nameInput;
  }

  private addRule() {
    this.rules.push({
      id: `custom-${Date.now()}`,
      name: '',
      content: '- ',
      enabled: true,
      condition: 'always',
    });
    this.rulesEl.empty();
    let lastName: TextComponent | undefined;
    this.rules.forEach((rule, index) => {
      lastName = this.renderRule(rule, index);
    });
    lastName?.inputEl.focus();
    lastName?.inputEl.scrollIntoView({ block: 'center' });
    this.changed();
  }

  private moveRule(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= this.rules.length) return;
    const [rule] = this.rules.splice(index, 1);
    this.rules.splice(target, 0, rule);
    this.renderRules();
    this.changed();
  }

  private confirmReset() {
    new MarkerOkayCancelDialog(
      this.app,
      `Reset ${this.config.title.toLowerCase()}`,
      'This replaces the base instructions and all rules, including your own rules, with the defaults.',
      (confirmed) => {
        if (!confirmed) return;
        this.settings[this.config.introKey] = this.config.defaultIntro;
        this.settings[this.config.rulesKey] = this.config.getDefaultRules();
        this.onOpen();
        this.changed();
      }
    ).open();
  }

  private renderPreview() {
    if (!this.previewEl) return;
    this.previewEl.setText(this.config.buildPreview(this.settings));
  }

  private changed() {
    this.renderPreview();
    this.debouncedSave();
  }

  private async save() {
    await this.saveSettings();
  }
}
