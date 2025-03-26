import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/options";

export const { auth, handlers } = NextAuth(authOptions);

export { authOptions }; 