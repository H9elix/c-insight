/** Embedded in the preview's existing script; source and scroll authority stay untouched. */
export const PREVIEW_HEADER_CLIENT = String.raw`
    function updatePreviewHeader(header) {
      if (!header || typeof header !== 'object') return;
      const title = document.querySelector('.title');
      for (const [field, selector] of Object.entries({kind:'.preview-kind',symbol:'.preview-symbol',fileName:'.preview-file',line:'.preview-line'})) {
        const element = document.querySelector(selector);
        if (element && typeof header[field] === 'string') element.textContent = header[field];
      }
      document.querySelector('.symbol-part').hidden = !header.symbol;
      document.querySelector('.location').hidden = !header.fileName;
      if (title && typeof header.tooltip === 'string') {
        title.title = header.tooltip;
        title.setAttribute('aria-label', header.tooltip);
      }
    }
    function updatePreviewStatus(message, error = false, loading = false) {
      const status = document.querySelector('.preview-status');
      if (!status) return;
      status.classList.toggle('error', error);
      status.classList.toggle('loading', loading);
      status.title = message;
      status.setAttribute('aria-label', message);
      const symbol = status.querySelector('.status-symbol'), label = status.querySelector('.status-label');
      symbol.textContent = error ? '⚠' : loading ? '◌' : 'ⓘ';
      label.hidden = !error;
      label.textContent = error ? text.loadingFailed : '';
      const announcement = document.getElementById('preview-announcement');
      if (announcement) announcement.textContent = error || loading ? message : '';
    }
    document.querySelector('.controls')?.addEventListener('focusin', event => {
      const target = event.target.closest?.('button');
      if (!target) return;
      const controls = event.currentTarget, item = target.getBoundingClientRect(), box = controls.getBoundingClientRect();
      const left = box.left + controls.clientLeft, right = left + controls.clientWidth;
      if (item.left < left) controls.scrollLeft += item.left - left;
      else if (item.right > right) controls.scrollLeft += item.right - right;
    });
`;
