class PDFMerger {
    constructor() {
        this.pdfs = [];       // { doc, file } for each loaded PDF
        this.slotCount = 0;   // increments for unique slot IDs
        this.mergedPdfBytes = null;

        this.waitForPDFLib().then(() => {
            this.initializeElements();
            this.bindEvents();
            this.addSlot();   // first slot
            this.addSlot();   // second slot
        });
    }

    async waitForPDFLib() {
        let attempts = 0;
        while (typeof PDFLib === 'undefined' && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        if (typeof PDFLib === 'undefined') {
            throw new Error('PDF-lib library failed to load');
        }
    }

    initializeElements() {
        this.uploadSection = document.getElementById('uploadSection');
        this.mergeBtn      = document.getElementById('mergeBtn');
        this.clearBtn      = document.getElementById('clearBtn');
        this.downloadBtn   = document.getElementById('downloadBtn');
        this.filenameInput = document.getElementById('filename');
        this.progressSection = document.getElementById('progressSection');
        this.progressFill    = document.getElementById('progressFill');
        this.progressText    = document.getElementById('progressText');
        this.resultSection   = document.getElementById('resultSection');
        this.addFileBtn      = document.getElementById('addFileBtn');
    }

    bindEvents() {
        this.mergeBtn.addEventListener('click', () => this.mergePDFs());
        this.clearBtn.addEventListener('click', () => this.clearAll());
        this.downloadBtn.addEventListener('click', () => this.downloadMergedPDF());
        this.addFileBtn.addEventListener('click', () => this.addSlot());
    }

    // --- Slot management ---

    addSlot() {
        const id = this.slotCount++;
        this.pdfs.push(null);   // placeholder at index id

        const row = document.createElement('div');
        row.className = 'slot-row';
        row.dataset.slotId = id;

        // Drop zone label
        const label = document.createElement('label');
        label.htmlFor = `pdf-slot-${id}`;
        label.className = 'file-label';
        label.style.flex = '1';

        const icon = document.createElement('i');
        icon.className = 'fas fa-cloud-upload-alt';
        icon.setAttribute('aria-hidden', 'true');

        const span = document.createElement('span');
        span.textContent = `Select PDF ${id + 1}`;

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf';
        input.className = 'file-input';
        input.id = `pdf-slot-${id}`;
        input.addEventListener('change', (e) => {
            if (e.target.files[0]) this.processFileSelection(e.target.files[0], id);
        });

        label.appendChild(icon);
        label.appendChild(span);
        label.appendChild(input);

        // File info strip
        const info = document.createElement('div');
        info.className = 'file-info';
        info.id = `file-info-${id}`;

        // Remove button (hidden on first two slots until a 3rd exists)
        const removeBtn = document.createElement('button');
        removeBtn.className = 'slot-remove';
        removeBtn.title = 'Remove this slot';
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.addEventListener('click', () => this.removeSlot(id));

        const wrapper = document.createElement('div');
        wrapper.style.flex = '1';
        wrapper.appendChild(label);
        wrapper.appendChild(info);

        row.appendChild(wrapper);
        row.appendChild(removeBtn);
        this.uploadSection.appendChild(row);

        this.setupDragAndDrop(label, id);
        this.syncRemoveButtons();
        this.updateMergeButton();
    }

    removeSlot(id) {
        const row = this.uploadSection.querySelector(`[data-slot-id="${id}"]`);
        if (row) row.remove();
        this.pdfs[id] = null;
        this.syncRemoveButtons();
        this.updateMergeButton();
    }

    // Hide remove buttons when only 2 slots remain
    syncRemoveButtons() {
        const rows = this.uploadSection.querySelectorAll('.slot-row');
        rows.forEach(row => {
            const btn = row.querySelector('.slot-remove');
            if (btn) btn.style.visibility = rows.length <= 2 ? 'hidden' : 'visible';
        });
    }

    // --- Drag and drop ---

    setupDragAndDrop(label, id) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
            label.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
        });
        ['dragenter', 'dragover'].forEach(ev => {
            label.addEventListener(ev, () => this.highlight(label));
        });
        ['dragleave', 'drop'].forEach(ev => {
            label.addEventListener(ev, () => this.unhighlight(label));
        });
        label.addEventListener('drop', e => {
            const file = e.dataTransfer.files[0];
            if (file) this.processFileSelection(file, id);
        });
    }

    highlight(el) {
        el.style.borderColor = 'var(--primary-color)';
        el.style.backgroundColor = 'var(--hover-bg)';
    }

    unhighlight(el) {
        el.style.borderColor = 'var(--border-color)';
        el.style.backgroundColor = 'var(--secondary-bg)';
    }

    // --- File loading ---

    async processFileSelection(file, id) {
        if (!file) return;
        if (file.size > 52428800) {
            this.showError('File too large. Maximum size is 50MB.');
            return;
        }
        if (file.size === 0) {
            this.showError('Selected file is empty.');
            return;
        }

        this.showLoadingState(id);

        try {
            await this.loadPDF(file, id);
        } catch (error) {
            console.error('Error loading PDF:', error);
            this.resetSlotState(id);
            if (error.message.includes('password') || error.message.includes('encrypted')) {
                this.showError('This PDF is password-protected. Please use an unprotected PDF.');
            } else if (error.message.includes('Invalid PDF')) {
                this.showError('This file is not a valid PDF.');
            } else {
                this.showError(`Could not load "${file.name}". Please try another file.`);
            }
        }
    }

    async loadPDF(file, id) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const uint8Array = new Uint8Array(arrayBuffer);

                    if (!this.isValidPDFFile(uint8Array)) {
                        reject(new Error('Invalid PDF file format'));
                        return;
                    }

                    const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, {
                        ignoreEncryption: false,
                        parseSpeed: PDFLib.ParseSpeeds.Fastest,
                        throwOnInvalidObject: false
                    });

                    if (pdfDoc.getPageCount() === 0) {
                        reject(new Error('PDF has no pages'));
                        return;
                    }

                    this.pdfs[id] = { doc: pdfDoc, file };
                    this.updateFileInfo(id, file, pdfDoc);
                    this.updateFileLabel(id, file);
                    this.updateMergeButton();
                    resolve();
                } catch (err) {
                    console.error('PDF load error:', err);
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Error reading file'));
            reader.readAsArrayBuffer(file);
        });
    }

    isValidPDFFile(uint8Array) {
        const sig = [0x25, 0x50, 0x44, 0x46];
        if (uint8Array.length < 4) return false;
        return sig.every((byte, i) => uint8Array[i] === byte);
    }

    // --- UI state helpers ---

    showLoadingState(id) {
        const label = this.uploadSection.querySelector(`[data-slot-id="${id}"] .file-label`);
        if (!label) return;
        label.style.opacity = '0.7';
        label.querySelector('span').textContent = 'Loading PDF...';
        label.querySelector('i').className = 'fas fa-spinner fa-spin';
    }

    resetSlotState(id) {
        this.pdfs[id] = null;
        const row = this.uploadSection.querySelector(`[data-slot-id="${id}"]`);
        if (!row) return;
        const input = row.querySelector('input[type="file"]');
        if (input) input.value = '';
        const info = document.getElementById(`file-info-${id}`);
        if (info) info.classList.remove('show');
        this.resetFileLabel(id, `Select PDF ${id + 1}`);
        this.updateMergeButton();
    }

    resetFileLabel(id, text) {
        const label = this.uploadSection.querySelector(`[data-slot-id="${id}"] .file-label`);
        if (!label) return;
        label.classList.remove('success');
        label.style.opacity = '1';
        label.querySelector('span').textContent = text;
        label.querySelector('i').className = 'fas fa-cloud-upload-alt';
    }

    updateFileInfo(id, file, pdfDoc) {
        const info = document.getElementById(`file-info-${id}`);
        if (!info) return;

        info.innerHTML = '';

        const icon = document.createElement('i');
        icon.className = 'fas fa-file-pdf';
        icon.style.cssText = 'color: #e74c3c; margin-right: 8px;';
        icon.setAttribute('aria-hidden', 'true');

        const nameEl = document.createElement('strong');
        nameEl.textContent = file.name;

        const br = document.createElement('br');

        const metaEl = document.createElement('span');
        metaEl.style.color = 'var(--text-secondary)';
        const pages = pdfDoc.getPageCount();
        metaEl.textContent = `${pages} page${pages !== 1 ? 's' : ''} • ${this.formatFileSize(file.size)}`;

        info.appendChild(icon);
        info.appendChild(nameEl);
        info.appendChild(br);
        info.appendChild(metaEl);
        info.classList.add('show');
    }

    updateFileLabel(id, file) {
        const label = this.uploadSection.querySelector(`[data-slot-id="${id}"] .file-label`);
        if (!label) return;
        label.classList.add('success');
        label.style.opacity = '1';
        label.querySelector('span').textContent = file.name;
        label.querySelector('i').className = 'fas fa-check-circle';
    }

    updateMergeButton() {
        const loaded = this.pdfs.filter(Boolean);
        const canMerge = loaded.length >= 2;
        this.mergeBtn.disabled = !canMerge;
        this.mergeBtn.style.opacity = canMerge ? '1' : '0.6';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // --- Merge ---

    async mergePDFs() {
        const loadedPdfs = this.pdfs.filter(Boolean);
        if (loadedPdfs.length < 2) {
            this.showError('Please select at least two PDF files before merging.');
            return;
        }

        try {
            this.showProgress();
            this.mergeBtn.classList.add('loading');
            this.mergeBtn.disabled = true;

            const preserveBookmarks = document.getElementById('preserveBookmarks').checked;
            const mergedPdf = await PDFLib.PDFDocument.create();

            const totalPages = loadedPdfs.reduce((sum, p) => sum + p.doc.getPageCount(), 0);
            let copiedPages = 0;

            this.updateProgress(0, 'Starting merge...');

            for (const pdf of loadedPdfs) {
                const count = pdf.doc.getPageCount();
                for (let i = 0; i < count; i++) {
                    const [page] = await mergedPdf.copyPages(pdf.doc, [i]);
                    mergedPdf.addPage(page);
                    copiedPages++;
                    const percent = Math.round((copiedPages / totalPages) * 85);
                    this.updateProgress(percent, `Copying page ${copiedPages} of ${totalPages}...`);
                }
            }

            this.updateProgress(90, 'Finalizing merged PDF...');

            if (preserveBookmarks) {
                try {
                    const outline = loadedPdfs[0].doc.catalog.lookupMaybe(
                        PDFLib.PDFName.of('Outlines'), PDFLib.PDFDict
                    );
                    if (outline) {
                        const outlineRef = await mergedPdf.context.obj(outline);
                        mergedPdf.catalog.set(PDFLib.PDFName.of('Outlines'), outlineRef);
                    }
                } catch (e) {
                    console.warn('Could not copy bookmarks:', e);
                }
            }

            this.mergedPdfBytes = await mergedPdf.save();
            this.updateProgress(100, 'PDF merged successfully!');

            setTimeout(() => {
                this.hideProgress();
                this.showResult();
                this.mergeBtn.classList.remove('loading');
                this.mergeBtn.disabled = false;
            }, 800);

        } catch (error) {
            this.hideProgress();
            this.mergeBtn.classList.remove('loading');
            this.mergeBtn.disabled = false;
            console.error('Merge error:', error);
            this.showError('Failed to merge PDFs. Please try again.');
        }
    }

    // --- Progress & result ---

    showProgress() {
        this.progressSection.style.display = 'block';
        this.resultSection.style.display = 'none';
    }

    hideProgress() {
        this.progressSection.style.display = 'none';
    }

    updateProgress(percentage, text) {
        this.progressFill.style.width = percentage + '%';
        this.progressText.textContent = text;
    }

    showResult() {
        this.resultSection.style.display = 'block';
    }

    // --- Download ---

    downloadMergedPDF() {
        if (!this.mergedPdfBytes) {
            this.showError('No merged PDF available for download.');
            return;
        }
        try {
            const filename = this.filenameInput.value.trim() || 'merged-document';
            const blob = new Blob([this.mergedPdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename.endsWith('.pdf') ? filename : filename + '.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            const original = this.downloadBtn.innerHTML;
            this.downloadBtn.innerHTML = '<i class="fas fa-check"></i> Downloaded!';
            setTimeout(() => { this.downloadBtn.innerHTML = original; }, 2000);
        } catch (error) {
            console.error('Download error:', error);
            this.showError('Error downloading the merged PDF.');
        }
    }

    // --- Clear ---

    clearAll() {
        this.pdfs = [];
        this.mergedPdfBytes = null;
        this.uploadSection.innerHTML = '';
        this.slotCount = 0;
        this.resultSection.style.display = 'none';
        this.progressSection.style.display = 'none';
        this.filenameInput.value = 'merged-document';
        this.addSlot();
        this.addSlot();
        this.updateMergeButton();

        const original = this.clearBtn.innerHTML;
        this.clearBtn.innerHTML = '<i class="fas fa-check"></i> Cleared!';
        setTimeout(() => { this.clearBtn.innerHTML = original; }, 1500);
    }

    // --- Error toast ---

    showError(message) {
        document.querySelectorAll('.error-toast').forEach(el => el.remove());
        const toast = document.createElement('div');
        toast.className = 'error-toast';
        toast.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            background: #dc3545; color: white;
            padding: 15px 20px; border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 1000; max-width: 400px;
            font-family: inherit;
        `;
        const icon = document.createElement('i');
        icon.className = 'fas fa-exclamation-triangle';
        icon.style.marginRight = '10px';
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createTextNode(message);
        toast.appendChild(icon);
        toast.appendChild(text);
        document.body.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 5000);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        new PDFMerger();
    } catch (error) {
        console.error('Failed to initialize PDF Merger:', error);
        document.body.innerHTML = `
            <div style="text-align:center;padding:50px;color:#dc3545;font-family:Arial,sans-serif;">
                <h2>Error Loading PDF Merger</h2>
                <p>The PDF library failed to load. Please refresh the page and try again.</p>
                <button onclick="location.reload()" style="padding:10px 20px;background:#007bff;color:white;border:none;border-radius:5px;cursor:pointer;">
                    Refresh Page
                </button>
            </div>
        `;
    }
});