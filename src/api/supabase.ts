import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// ESM 정적 임포트 시점 이슈를 우회하기 위해 모듈 로드 즉시 dotenv config 실행
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

if (!supabase) {
  console.warn("⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from environment variables. Supabase features will be disabled.");
}
