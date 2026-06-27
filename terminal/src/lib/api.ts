import axios from "axios";
import { clearUser } from "./storage";
import { API_BASE } from "../constants";

export const api = axios.create({
	baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
	const token = localStorage.getItem("token");

	if (token) {
		config.headers.Authorization = `Bearer ${token}`;
	}

	return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || "";

    if (status === 401 && !url.includes("/api/auth/login")) {
      clearUser();

      sessionStorage.setItem(
        "authMessage",  
        "Your session has expired. Please login again."
      );

      window.location.reload();
    }

    return Promise.reject(error);
  }
);
