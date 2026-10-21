document.querySelectorAll("[data-component=Action]").forEach(button => {
  button.addEventListener("click", () => {
    if (button.dataset.next === "confirmation.html") sessionStorage.setItem("atelier-reservation", "A1042");
    location.href = button.dataset.next;
  });
});
