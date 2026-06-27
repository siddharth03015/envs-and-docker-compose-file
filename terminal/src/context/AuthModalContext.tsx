"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { loginRequest, registerRequest } from "@/lib/auth";
import { saveUser, loadUser, clearUser, StoredUser } from "@/lib/storage";

type AuthView = "login" | "register";

interface AuthModalContextType {
  isOpen:      boolean;
  view:        AuthView;
  user:        StoredUser | null;
  initialized: boolean;

  openModal: (view?: AuthView) => void;
  closeModal: () => void;

  login:    (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout:   () => void;
}

const AuthModalContext = createContext<AuthModalContextType | undefined>(
  undefined
);

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen]           = useState(false);
  const [view, setView]               = useState<AuthView>("login");
  const [user, setUser]               = useState<StoredUser | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const msg = sessionStorage.getItem("authMessage");
  
    if (msg) {
      sessionStorage.removeItem("authMessage");
  
      setView("login");
      setIsOpen(true);
  
      // store message for modal
      sessionStorage.setItem("authModalError", msg);
    }
  }, []);  
  
  useEffect(() => {
    const savedUser = loadUser();
    if (savedUser) setUser(savedUser);
    setInitialized(true);
  }, []);

  const openModal = (v: AuthView = "login") => {
    setView(v);
    setIsOpen(true);
  };

  const closeModal = () => setIsOpen(false);

  const login = async (username: string, password: string) => {
    const { token, user_id, username: uname } = await loginRequest(
      username,
      password
    );

    const userObj = { user_id, username: uname };

    saveUser(token, userObj);
    setUser(userObj);

    closeModal();
  };

  const register = async (username: string, password: string) => {
    const { token, user_id, username: uname } = await registerRequest(
      username,
      password
    );

    const userObj = { user_id, username: uname };

    saveUser(token, userObj);
    setUser(userObj);

    closeModal();
  };

  const logout = () => {
    clearUser();
    setUser(null);
  };

  return (
    <AuthModalContext.Provider
      value={{ isOpen, view, user, initialized, openModal, closeModal, login, register, logout }}
    >
      {children}
    </AuthModalContext.Provider>
  );
}

export function useAuthModal() {
  const context = useContext(AuthModalContext);
  if (!context) {
    throw new Error("useAuthModal must be used within an AuthModalProvider");
  }
  return context;
}
