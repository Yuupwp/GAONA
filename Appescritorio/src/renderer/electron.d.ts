interface Window {
    electronAPI: {
        abrirPdf: (datos: ArrayBuffer) => Promise<void>;
        maximizeWindow: () => void;
    };
}