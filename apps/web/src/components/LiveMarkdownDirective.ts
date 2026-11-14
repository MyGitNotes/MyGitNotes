import { EditorView, WidgetType } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { DIRECTIVE_TEMPLATES, type DirectiveModel, GRID_COLUMN_OPTIONS, gridColumnCount, localizedDirectiveLabel, parseDirectiveModel, serializeDirectiveModel, setGridColumns } from '../lib/directive-editing.js';
import { localizedHandoutVariants } from '../lib/directives.js';
import { type NoteRenderOptions, renderNote } from '../lib/markdown.js';
import { isSlideDirective } from '../lib/slides/directives.js';
import { hydrateMermaid } from '../lib/mermaid.js';
import { hydrateQrCodes } from '../lib/qrcode.js';
import type { TranslationKey } from '../lib/i18n/en.js';
import { DEFAULT_YOUTUBE_LABELS, youtubeLabels } from '../lib/youtube-embed.js';

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

export class LiveMarkdownDirective extends WidgetType {
  /** `slides`: the block is in a `type: slide` note, whose slide directives draw as a deck reads them. */
  constructor(readonly text: string, readonly path: string, readonly from: number, readonly readOnly: boolean, readonly currentType: string, readonly currentVariant?: string, readonly t?: Translate, readonly notebookId?: string, readonly slides = false) {
    super();
  }

  eq(other: LiveMarkdownDirective) {
    return (this.text === other.text && this.path === other.path && this.from === other.from && this.readOnly === other.readOnly && this.currentType === other.currentType && this.currentVariant === other.currentVariant && this.notebookId === other.notebookId && this.slides === other.slides);
  }

  private get renderOptions(): NoteRenderOptions | undefined {
    return this.slides ? { slides: 'preview' } : undefined;
  }

  /** The block formats a select offers: the templates, and the block's own type when it is none of them, so choosing nothing never changes it. */
  private typeOptions(select: HTMLSelectElement, current: string) {
    const types = DIRECTIVE_TEMPLATES.map(template => template.type);
    for (const type of types.includes(current) ? types : [...types, current]) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = types.includes(type) ? localizedDirectiveLabel(type, this.t) : type;
      if (type === current) option.selected = true;
      select.append(option);
    }
    select.value = current;
  }

  private stopMermaid = () => {};
  private stopQrCodes = () => {};

  /** `this.t`, falling back to the given zh-TW string when no translator was supplied. */
  private tt(key: TranslationKey, fallback: string, params?: Record<string, string | number>): string {
    return this.t?.(key, params) ?? fallback;
  }

  /** The column-count options of a grid: the offered counts, and the grid's own count when it is none of them, so no existing grid is silently changed. */
  private gridColumnSelect(model: DirectiveModel): HTMLSelectElement {
    const select = document.createElement('select');
    const current = gridColumnCount(model.attrs);
    const counts: number[] = [...GRID_COLUMN_OPTIONS];
    if (!counts.includes(current)) counts.push(current);
    for (const count of counts.sort((a, b) => a - b)) {
      const option = document.createElement('option');
      option.value = String(count);
      option.textContent = this.tt('directive.grid.columns', `${count} 欄`, { count });
      if (count === current) option.selected = true;
      select.append(option);
    }
    select.value = String(current);
    return select;
  }

  /** `model` with its grid's column count set to `cols`, the cells it lacks added in the note language. */
  private withGridColumns(model: DirectiveModel, cols: number): DirectiveModel {
    return setGridColumns(model, cols, n => this.tt('directive.grid.cellN', `第 ${n} 欄內容`, { n }));
  }

  /** Draws the mermaid diagrams and the QR codes a directive's body holds, replacing the redraw watch of any earlier body. */
  private hydrateDiagrams(view: EditorView, body: HTMLElement) {
    this.stopMermaid();
    this.stopQrCodes();
    this.stopMermaid = hydrateMermaid(body, { errorLabel: this.t?.('mermaid.error'), onSettled: () => view.requestMeasure() });
    this.stopQrCodes = hydrateQrCodes(body, { onSettled: () => view.requestMeasure() });
  }

  destroy() {
    this.stopMermaid();
    this.stopQrCodes();
  }

  toDOM(view: EditorView) {
    const model: DirectiveModel = parseDirectiveModel(this.text);

    const root = document.createElement('div');
    root.className = 'live-md-directive live-md-rendered prose-custom';
    root.contentEditable = 'false';
    root.dataset.directiveFrom = String(this.from);
    root.dataset.directiveType = model.type;

    if (this.readOnly) {
      root.innerHTML = renderNote(this.text, this.path, undefined, this.t ? youtubeLabels(this.t) : DEFAULT_YOUTUBE_LABELS, this.notebookId, this.renderOptions);
      this.hydrateDiagrams(view, root);
      return root;
    }

    const saveChanges = (updatedModel: DirectiveModel) => {
      const newText = serializeDirectiveModel(updatedModel);
      if (newText !== this.text) {
        view.dispatch({ changes: { from: this.from, to: this.from + this.text.length, insert: newText }, annotations: isolateHistory.of('full'), userEvent: 'input.directive' });
        view.requestMeasure();
      }
    };

    // Render Preview Mode (Default)
    const renderPreview = () => {
      this.stopMermaid();
      this.stopQrCodes();
      root.innerHTML = '';
      root.classList?.remove('live-directive-editing');

      // 1. Build Toolbar
      const toolbar = document.createElement('div');
      toolbar.className = 'live-directive-toolbar';
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', this.tt('directive.editor.toolbarLabel', 'Directive 區塊操作列'));

      // Format Select
      const typeSelect = document.createElement('select');
      typeSelect.className = 'live-directive-type-select';
      typeSelect.title = this.tt('directive.editor.changeFormat', '更換區塊格式');
      typeSelect.setAttribute('aria-label', this.tt('directive.editor.changeFormat', '更換區塊格式'));
      this.typeOptions(typeSelect, model.type);
      typeSelect.addEventListener('mousedown', event => event.stopPropagation());
      typeSelect.addEventListener('change', () => {
        model.type = typeSelect.value;
        saveChanges(model);
      });
      // A slide directive of a slide note is no general block: it has no other format to change to, and no title.
      const slideDirective = this.slides && isSlideDirective(model.type);
      if (!slideDirective) toolbar.append(typeSelect);

      // Document style select (the handout type name remains for syntax compatibility)
      if (model.type === 'handout') {
        const variantSelect = document.createElement('select');
        variantSelect.className = 'live-directive-variant-select';
        variantSelect.title = this.tt('directive.editor.changeVariant', '更換文件樣式');
        variantSelect.setAttribute('aria-label', this.tt('directive.editor.changeVariant', '更換文件樣式'));
        for (const [vKey, vLabel] of Object.entries(localizedHandoutVariants(this.t))) {
          const option = document.createElement('option');
          option.value = vKey;
          option.textContent = vLabel;
          if (vKey === (model.attrs.variant || 'report')) option.selected = true;
          variantSelect.append(option);
        }
        variantSelect.value = model.attrs.variant || 'report';
        variantSelect.addEventListener('mousedown', event => event.stopPropagation());
        variantSelect.addEventListener('change', () => {
          model.attrs.variant = variantSelect.value;
          saveChanges(model);
        });
        toolbar.append(variantSelect);
      }

      // Column count of a grid
      if (model.type === 'grid') {
        const gridSelect = this.gridColumnSelect(model);
        gridSelect.className = 'live-directive-grid-select';
        gridSelect.title = this.tt('directive.editor.gridColumns', '欄數');
        gridSelect.setAttribute('aria-label', this.tt('directive.editor.gridColumns', '欄數'));
        gridSelect.addEventListener('mousedown', event => event.stopPropagation());
        gridSelect.addEventListener('change', () => saveChanges(this.withGridColumns(model, Number(gridSelect.value))));
        toolbar.append(gridSelect);
      }

      // Title input field on toolbar for fast renaming
      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'live-directive-title-input';
      titleInput.placeholder = model.type === 'coc-stat' ? this.tt('directive.editor.namePlaceholder', '人物名稱...') : this.tt('directive.editor.titlePlaceholder', '自訂標題...');
      titleInput.title = this.tt('directive.editor.customTitle', '自訂標題');
      titleInput.value = model.title;
      titleInput.setAttribute('aria-label', this.tt('directive.editor.customTitle', '自訂標題'));

      titleInput.addEventListener('mousedown', event => event.stopPropagation());
      const commitTitle = () => {
        if (titleInput.value !== model.title) {
          model.title = titleInput.value;
          saveChanges(model);
        }
      };
      titleInput.addEventListener('blur', commitTitle);
      titleInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitTitle();
          titleInput.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          titleInput.value = model.title;
          titleInput.blur();
        }
      });
      if (!slideDirective) toolbar.append(titleInput);

      // Edit body button (明確文字「編輯內文」)
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'live-directive-edit-btn';
      editBtn.textContent = this.tt('directive.editor.editBody', '編輯內文');
      editBtn.title = this.tt('directive.editor.openEditForm', '開啟完整編輯表單');
      editBtn.setAttribute('aria-label', this.tt('directive.editor.openEditForm', '開啟完整編輯表單'));

      editBtn.addEventListener('mousedown', event => event.preventDefault());
      editBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        renderEditForm();
      });
      toolbar.append(editBtn);

      // 2. Render Card Content
      const contentContainer = document.createElement('div');
      contentContainer.className = 'live-directive-preview-content';
      contentContainer.innerHTML = renderNote(this.text, this.path, undefined, this.t ? youtubeLabels(this.t) : DEFAULT_YOUTUBE_LABELS, this.notebookId, this.renderOptions);

      // Double click to enter edit form
      contentContainer.addEventListener('dblclick', event => {
        if ((event.target as HTMLElement).closest('button, select, input, a, summary')) return;
        event.preventDefault();
        renderEditForm();
      });

      root.append(toolbar, contentContainer);
      this.hydrateDiagrams(view, contentContainer);
    };

    // Render Full Inline Form Editor
    const renderEditForm = () => {
      root.innerHTML = '';
      root.classList?.add('live-directive-editing');

      const panel = document.createElement('div');
      panel.className = 'live-directive-editor-panel';

      // Header
      const header = document.createElement('div');
      header.className = 'live-directive-editor-header';
      const badge = document.createElement('span');
      badge.className = 'live-directive-editor-badge';
      badge.textContent = this.tt('directive.editor.editingBadge', `編輯區塊：${model.type.toUpperCase()}`, { type: model.type.toUpperCase() });
      header.append(badge);

      // Form Row 1: Type & Title
      const row1 = document.createElement('div');
      row1.className = 'live-directive-form-row';

      const typeField = document.createElement('div');
      typeField.className = 'live-directive-form-field';
      const typeLabel = document.createElement('label');
      typeLabel.textContent = this.tt('directive.editor.blockFormat', '區塊格式');
      const formTypeSelect = document.createElement('select');
      this.typeOptions(formTypeSelect, model.type);
      typeField.append(typeLabel, formTypeSelect);

      const titleField = document.createElement('div');
      titleField.className = 'live-directive-form-field';
      const titleLabel = document.createElement('label');
      titleLabel.textContent = model.type === 'coc-stat' ? this.tt('directive.editor.nameFieldLabel', '人物名稱 (Name)') : this.tt('directive.editor.titleFieldLabel', '區塊標題 (Title)');
      const formTitleInput = document.createElement('input');
      formTitleInput.type = 'text';
      formTitleInput.value = model.title;
      formTitleInput.placeholder = this.tt('directive.editor.titleInputPlaceholder', '輸入標題...');
      titleField.append(titleLabel, formTitleInput);

      if (!(this.slides && isSlideDirective(model.type))) row1.append(typeField, titleField);

      // Form Row 2 (document / stats compatibility fields)
      let row2: HTMLDivElement | null = null;
      let handoutIdInput: HTMLInputElement | null = null;
      let handoutKeeperInput: HTMLInputElement | null = null;
      let handoutVariantSelect: HTMLSelectElement | null = null;
      let cocRoleInput: HTMLInputElement | null = null;
      let gridColumnsSelect: HTMLSelectElement | null = null;

      if (model.type === 'handout') {
        row2 = document.createElement('div');
        row2.className = 'live-directive-form-row';

        const idField = document.createElement('div');
        idField.className = 'live-directive-form-field';
        const idLabel = document.createElement('label');
        idLabel.textContent = this.tt('directive.editor.handoutId', '文件編號 (ID)');
        handoutIdInput = document.createElement('input');
        handoutIdInput.type = 'text';
        handoutIdInput.value = model.attrs.id || 'DOC-01';
        idField.append(idLabel, handoutIdInput);

        const variantField = document.createElement('div');
        variantField.className = 'live-directive-form-field';
        const variantLabel = document.createElement('label');
        variantLabel.textContent = this.tt('directive.editor.handoutVariant', '文件樣式 (Variant)');
        handoutVariantSelect = document.createElement('select');
        for (const [k, v] of Object.entries(localizedHandoutVariants(this.t))) {
          const opt = document.createElement('option');
          opt.value = k;
          opt.textContent = v;
          if (k === (model.attrs.variant || 'report')) opt.selected = true;
          handoutVariantSelect.append(opt);
        }
        handoutVariantSelect.value = model.attrs.variant || 'report';
        variantField.append(variantLabel, handoutVariantSelect);

        const keeperField = document.createElement('div');
        keeperField.className = 'live-directive-form-field';
        const keeperLabel = document.createElement('label');
        keeperLabel.textContent = this.tt('directive.editor.handoutKeeper', '編輯備註 (Editor Note)');
        handoutKeeperInput = document.createElement('input');
        handoutKeeperInput.type = 'text';
        handoutKeeperInput.value = model.attrs.keeper || '';
        handoutKeeperInput.placeholder = this.tt('directive.editor.handoutKeeperPlaceholder', '例如：來源、使用時機或編輯說明...');
        keeperField.append(keeperLabel, handoutKeeperInput);

        row2.append(idField, variantField, keeperField);
      } else if (model.type === 'coc-stat') {
        row2 = document.createElement('div');
        row2.className = 'live-directive-form-row';

        const roleField = document.createElement('div');
        roleField.className = 'live-directive-form-field';
        const roleLabel = document.createElement('label');
        roleLabel.textContent = this.tt('directive.editor.cocRole', '身分／類別 (Role)');
        cocRoleInput = document.createElement('input');
        cocRoleInput.type = 'text';
        cocRoleInput.value = model.attrs.role || '';
        cocRoleInput.placeholder = this.tt('directive.editor.cocRolePlaceholder', '例如：研究者、講者、專案負責人...');
        roleField.append(roleLabel, cocRoleInput);

        row2.append(roleField);
      } else if (model.type === 'grid') {
        row2 = document.createElement('div');
        row2.className = 'live-directive-form-row';

        const columnsField = document.createElement('div');
        columnsField.className = 'live-directive-form-field';
        const columnsLabel = document.createElement('label');
        columnsLabel.textContent = this.tt('directive.editor.gridColumns', '欄數');
        gridColumnsSelect = this.gridColumnSelect(model);
        columnsField.append(columnsLabel, gridColumnsSelect);

        row2.append(columnsField);
      }

      // Body editor
      const bodyLabel = document.createElement('label');
      bodyLabel.className = 'live-directive-body-label';
      bodyLabel.textContent = this.tt('directive.editor.bodyLabel', '區塊正文內容 (支援 Markdown)');

      const bodyTextarea = document.createElement('textarea');
      bodyTextarea.className = 'live-directive-body-editor';
      bodyTextarea.value = model.body;
      bodyTextarea.placeholder = this.tt('directive.editor.bodyPlaceholder', '在此輸入內容...');

      // Footer Actions
      const footer = document.createElement('div');
      footer.className = 'live-directive-editor-footer';

      const hint = document.createElement('span');
      hint.className = 'live-directive-editor-hint';
      hint.textContent = this.tt('directive.editor.hint', 'Enter 換行 · ⌘/Ctrl+Enter 完成儲存 · Esc 取消');

      const actions = document.createElement('div');
      actions.className = 'live-directive-editor-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'live-directive-btn-cancel';
      cancelBtn.textContent = this.tt('directive.editor.cancel', '取消');
      cancelBtn.addEventListener('click', () => renderPreview());

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'live-directive-btn-save';
      saveBtn.textContent = this.tt('directive.editor.save', '完成儲存');

      const commitForm = () => {
        model.type = formTypeSelect.value;
        model.title = formTitleInput.value;
        model.body = bodyTextarea.value;
        if (handoutIdInput) model.attrs.id = handoutIdInput.value;
        if (handoutVariantSelect) model.attrs.variant = handoutVariantSelect.value;
        if (handoutKeeperInput) model.attrs.keeper = handoutKeeperInput.value;
        if (cocRoleInput) model.attrs.role = cocRoleInput.value;
        saveChanges(gridColumnsSelect ? this.withGridColumns(model, Number(gridColumnsSelect.value)) : model);
        renderPreview();
      };

      saveBtn.addEventListener('click', commitForm);

      panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          renderPreview();
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          commitForm();
        }
      });

      actions.append(cancelBtn, saveBtn);
      footer.append(hint, actions);

      panel.append(header, row1);
      if (row2) panel.append(row2);
      panel.append(bodyLabel, bodyTextarea, footer);

      root.append(panel);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => bodyTextarea.focus?.());
      } else {
        setTimeout(() => bodyTextarea.focus?.(), 0);
      }
    };

    renderPreview();
    return root;
  }
}
