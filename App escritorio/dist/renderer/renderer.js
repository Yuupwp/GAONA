"use strict";
const loginForm = document.getElementById("login-form");
const loginScreen = document.getElementById("login-screen");
const mainScreen = document.getElementById("main-screen");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const usernameError = document.getElementById("username-error");
const passwordError = document.getElementById("password-error");
const menuItems = document.querySelectorAll(".menu-item");
const sections = document.querySelectorAll(".dashboard-section, .empty-section");
const sectionTitle = document.getElementById("section-title");
loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    // Limpiar errores anteriores
    usernameError.textContent = "";
    passwordError.textContent = "";
    usernameInput.parentElement?.classList.remove("has-error");
    passwordInput.parentElement?.classList.remove("has-error");
    let hasError = false;
    // Validar nombre
    if (username === "") {
        usernameError.textContent =
            "El nombre es obligatorio.";
        usernameInput.parentElement?.classList.add("has-error");
        hasError = true;
    }
    // Validar contraseña
    if (password === "") {
        passwordError.textContent =
            "La contraseña es obligatoria.";
        passwordInput.parentElement?.classList.add("has-error");
        hasError = true;
    }
    // Si hay errores, no continuar
    if (hasError) {
        return;
    }
    // Ocultar login
    loginScreen.classList.add("hidden");
    // Mostrar pantalla principal
    mainScreen.classList.remove("hidden");
    // Maximizar ventana
    window.electronAPI.maximizeWindow();
});
menuItems.forEach((item) => {
    item.addEventListener("click", () => {
        const section = item.dataset.section;
        if (!section) {
            return;
        }
        // Quitar selección anterior
        menuItems.forEach((menu) => {
            menu.classList.remove("active");
        });
        // Activar elemento seleccionado
        item.classList.add("active");
        // Ocultar todas las secciones
        sections.forEach((currentSection) => {
            currentSection.classList.add("hidden");
        });
        // Mostrar sección seleccionada
        const selectedSection = document.getElementById(`${section}-section`);
        if (selectedSection) {
            selectedSection.classList.remove("hidden");
        }
        // Cambiar título
        const selectedText = item.querySelector("span:last-child");
        if (selectedText) {
            sectionTitle.textContent =
                selectedText.textContent || "";
        }
    });
});
