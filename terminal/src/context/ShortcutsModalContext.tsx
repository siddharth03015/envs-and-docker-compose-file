"use client";
import { createContext, useContext, useState } from "react";

type ShortcutsModalContextType = {
  isOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
};

const ShortcutsModalContext = createContext<ShortcutsModalContextType | undefined>(undefined);

export function ShortcutsModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openModal = () => setIsOpen(true);
  const closeModal = () => setIsOpen(false);

  return (
    <ShortcutsModalContext.Provider value={{ isOpen, openModal, closeModal }}>
      {children}
    </ShortcutsModalContext.Provider>
  );
}

export function useShortcutsModal() {
  const context = useContext(ShortcutsModalContext);
  if (!context) {
    throw new Error("useShortcutsModal must be used within ShortcutsModalProvider");
  }
  return context;
}
