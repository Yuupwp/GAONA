const CatalogProducts = (() => {
    function normalize(text) {
        return String(text).toLowerCase().normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "").trim();
    }

    function imageUrl(value) {
        if (!value) return "";
        try {
            const url = new URL(value, document.baseURI);
            return ["http:", "https:"].includes(url.protocol) ? url.href : "";
        } catch {
            return "";
        }
    }

    function parse(data) {
        if (!Array.isArray(data)) throw new Error("Respuesta de productos inválida");
        const ids = new Set();
        return data.map(item => {
            const optionalText = value => value == null || typeof value === "string";
            if (!item || typeof item.id !== "string" || !item.id.trim() ||
                ids.has(item.id) || typeof item.nombre !== "string" || !item.nombre.trim() ||
                !optionalText(item.descripcion) || !optionalText(item.imagenUrl) ||
                !item.categoria || typeof item.categoria.nombre !== "string" ||
                !item.categoria.nombre.trim() ||
                !["string", "number"].includes(typeof item.precioDesde) ||
                String(item.precioDesde).trim() === "" ||
                !Number.isFinite(Number(item.precioDesde)) || Number(item.precioDesde) < 0) {
                throw new Error("Datos de producto inválidos");
            }
            ids.add(item.id);
            return {
                id: item.id,
                name: item.nombre.trim(),
                description: item.descripcion?.trim() || "Descripción no disponible.",
                price: Number(item.precioDesde),
                image: imageUrl(item.imagenUrl),
                category: item.categoria.nombre.trim()
            };
        });
    }

    async function load() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`${API_URL.replace(/\/$/, "")}/productos`, {
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return parse(await response.json());
        } finally {
            clearTimeout(timer);
        }
    }

    function filter(products, search, category, sort) {
        const query = normalize(search);
        const result = products.filter(product =>
            normalize(`${product.name} ${product.description} ${product.category}`).includes(query) &&
            (!category || product.category === category));
        if (sort === "low") result.sort((a, b) => a.price - b.price);
        if (sort === "high") result.sort((a, b) => b.price - a.price);
        return result;
    }

    return { normalize, parse, load, filter };
})();
