require('dotenv/config');

async function main() {
    const localDemoTarget = value => {
        try {
            const url = new URL(value);
            return ['postgres:', 'postgresql:'].includes(url.protocol) &&
                url.hostname === '127.0.0.1' && url.port === '5432' &&
                url.pathname === '/gaona_catalogo_demo';
        } catch {
            return false;
        }
    };
    if (process.env.NODE_ENV !== 'development' || process.env.GAONA_DEMO_SEED !== 'LOCAL_EMPTY_DATABASE' ||
        !localDemoTarget(process.env.DATABASE_URL) || !localDemoTarget(process.env.DIRECT_URL)) {
        throw Error('Se requiere desarrollo, autorización explícita y DATABASE_URL y DIRECT_URL locales hacia gaona_catalogo_demo.');
    }
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
        const created = await prisma.$transaction(async tx => {
            if (await tx.producto.count() !== 0) return false;
            const products = [
                { id: 'a0000000-0000-4000-8000-000000000001', categoria: 'Demostración',
                    nombre: '[DEMO] Puerta de ejemplo', descripcion: 'Dato de demostración; no es una oferta comercial.',
                    precioDesde: '1000.00', imagenUrl: 'img/puerta.jpg', tipo: 'PRODUCTO', activo: true },
                { id: 'a5507a59-1806-4fdc-a8f6-8e7f5431c997', categoria: 'Puertas',
                    nombre: '[DEMO] Puerta residencial Roble',
                    descripcion: 'Puerta de acabado tipo madera con diseño tradicional, ideal para entradas residenciales.',
                    precioDesde: '3500.00', imagenUrl: 'img/puerta-roble-demo.png', tipo: 'PRODUCTO', activo: true },
                { id: 'f62b2b37-73ef-401d-8a48-92bdb95dfd1e', categoria: 'Ventanas',
                    nombre: '[DEMO] Ventana corrediza de aluminio',
                    descripcion: 'Ventana de dos hojas corredizas, fabricada con marco de aluminio y cristal transparente. Ideal para espacios residenciales.',
                    precioDesde: '2650.00', imagenUrl: 'img/ventana-aluminio-demo.png', tipo: 'PRODUCTO', activo: true },
                { id: '4b8c2c0e-bbd3-4107-9a54-a92ef1e237c4', categoria: 'Canceles',
                    nombre: '[DEMO] Cancel corredizo de baño',
                    descripcion: 'Cancel de cristal transparente con sistema corredizo y acabados metálicos, diseñado para espacios de baño modernos.',
                    precioDesde: '4200.00', imagenUrl: 'img/cancel-bano-demo.png', tipo: 'PRODUCTO', activo: true },
                { id: '024af78e-8b0e-4583-ba90-a1ed8ed29fd9', categoria: 'Accesorios',
                    nombre: '[DEMO] Cerradura de seguridad',
                    descripcion: 'Cerradura con manija metálica y acabado de acero inoxidable para puertas residenciales.',
                    precioDesde: '650.00', imagenUrl: 'img/cerradura-seguridad-demo.png', tipo: 'PRODUCTO', activo: true }
            ];
            const categories = new Map();
            for (const product of products) {
                if (!categories.has(product.categoria)) {
                    const category = await tx.categoria.upsert({
                        where: { nombre: product.categoria },
                        update: {},
                        create: { nombre: product.categoria }
                    });
                    categories.set(product.categoria, category.id);
                }
                product.idCategoria = categories.get(product.categoria);
                delete product.categoria;
            }
            await tx.producto.createMany({ data: products, skipDuplicates: true });
            return true;
        }, { isolationLevel: 'Serializable' });
        console.log(created ? 'Datos DEMO creados en la base local vacía.' : 'La base ya contiene productos. No se modificó ningún registro.');
    } finally { await prisma.$disconnect(); }
}
main().catch(() => {
    console.error('No se cargaron datos. Verifica la configuración local de demostración y las condiciones indicadas en este script.');
    process.exitCode = 1;
});
