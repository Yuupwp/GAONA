const productosHistoricosEnsayo = Object.freeze([
    'web5c-puerta', 'web5c-ventana', 'web5c-mesa', 'web5c-silla',
    'web5c-armario', 'web5c-repisa', 'web5c-inactivo', 'web5c-material'
]);
const idsEnsayo = new Set(productosHistoricosEnsayo);
const esProductoEnsayo = id => idsEnsayo.has(id);
function crearCatalogoLocal(db) {
    return db.$extends({
        query: { producto: {
            findMany({ args, query }) {
                return query({ ...args, where: { AND: [args.where ?? {}, { id: { notIn: [...productosHistoricosEnsayo] } }] } });
            }
        } }
    });
}
module.exports = { productosHistoricosEnsayo, esProductoEnsayo, crearCatalogoLocal };
