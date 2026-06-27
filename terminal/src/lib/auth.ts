import { api } from "./api";

export async function loginRequest(username: string, password: string) {
  const res = await api.post("/api/auth/login", {
    username,
    password,
  });

  return res.data;
}

export async function registerRequest(username: string, password: string) {
  const res = await api.post("/api/auth/register", {
    username,
    password,
  });

  return res.data;
}