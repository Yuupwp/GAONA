const products = [
    ...document.querySelectorAll(".product-card")
];

const searchInput =
    document.getElementById("searchInput");

const categoryInputs =
    document.querySelectorAll(
        'input[name="category"]'
    );

const sortProducts =
    document.getElementById("sortProducts");

const productCount =
    document.getElementById("productCount");

const productsGrid =
    document.getElementById("productsGrid");



function updateProducts() {

    const search =
        searchInput.value
            .toLowerCase()
            .trim();


    const selectedCategory =
        document.querySelector(
            'input[name="category"]:checked'
        ).value;


    let visibleProducts =
        products.filter(product => {

            const name =
                product.dataset.name.toLowerCase();

            const category =
                product.dataset.category;


            const matchesSearch =
                name.includes(search);


            const matchesCategory =
                selectedCategory === "todos" ||
                category === selectedCategory;


            return matchesSearch &&
                   matchesCategory;

        });


    // ORDENAR

    const sort =
        sortProducts.value;


    if (sort === "low") {

        visibleProducts.sort(
            (a, b) =>
                Number(a.dataset.price) -
                Number(b.dataset.price)
        );

    }


    if (sort === "high") {

        visibleProducts.sort(
            (a, b) =>
                Number(b.dataset.price) -
                Number(a.dataset.price)
        );

    }


    // MOSTRAR

    products.forEach(product => {

        product.style.display = "none";

    });


    visibleProducts.forEach(product => {

        product.style.display = "block";

        productsGrid.appendChild(product);

    });


    // CONTADOR

    productCount.textContent =
        `${visibleProducts.length} producto${
            visibleProducts.length !== 1
                ? "s"
                : ""
        }`;

}



// EVENTOS

searchInput.addEventListener(
    "input",
    updateProducts
);


categoryInputs.forEach(input => {

    input.addEventListener(
        "change",
        updateProducts
    );

});


sortProducts.addEventListener(
    "change",
    updateProducts
);