const repository = import.meta.env.VITE_REPOSITORY_URL;
if (typeof repository === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repository)) {
  document.querySelector<HTMLAnchorElement>('#repository')!.href = repository;
  document.getElementById('repository-link')!.hidden = false;
}
