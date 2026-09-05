import { signUp, signIn, signOut, getSession, onAuthStateChange } from "./supabaseClient.js";

const authSection = document.getElementById("auth");
const appSection = document.getElementById("app");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const signUpButton = document.getElementById("auth-signup");
const signOutButton = document.getElementById("sign-out");

function showApp() {
  authSection.hidden = true;
  appSection.hidden = false;
}

function showAuth() {
  authSection.hidden = false;
  appSection.hidden = true;
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  try {
    await signIn(emailInput.value, passwordInput.value);
  } catch (err) {
    authError.textContent = err.message;
  }
});

signUpButton.addEventListener("click", async () => {
  authError.textContent = "";
  try {
    await signUp(emailInput.value, passwordInput.value);
  } catch (err) {
    authError.textContent = err.message;
  }
});

signOutButton.addEventListener("click", () => signOut());

onAuthStateChange((session) => {
  if (session) showApp();
  else showAuth();
});

getSession().then((session) => {
  if (session) showApp();
  else showAuth();
});
