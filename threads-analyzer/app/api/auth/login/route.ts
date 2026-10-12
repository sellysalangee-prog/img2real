import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookieOptions, STATE_COOKIE } from "@/lib/session";
import { authorizeUrl } from "@/lib/threads";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set(STATE_COOKIE, state, { ...cookieOptions, maxAge: 600 });
  return res;
}
