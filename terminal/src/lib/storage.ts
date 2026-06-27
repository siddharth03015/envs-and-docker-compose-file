export interface StoredUser {
  user_id: string;
  username: string;
}

export function saveUser(token: string, user: StoredUser) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

export function loadUser(): StoredUser | null {
  const saved = localStorage.getItem("user");
  return saved ? JSON.parse(saved) : null;
}

export function clearUser() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}