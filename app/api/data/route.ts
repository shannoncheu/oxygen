import { route,json,business } from '@/lib/server/api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=route(async request=>json(await business(request)));
