# -*- coding: utf-8 -*-
"""
한국투자증권 실전 API(kis_auth 기반)를 사용하여
52주 신고가 종목의 전체 종목수와 업종(섹터)별 종목수를 집계하는 스크립트입니다.
"""

import logging
import sys
import time
from typing import Optional
import pandas as pd
import kis_auth as ka

# 로깅 설정
logging.basicConfig(level=logging.INFO, format='%(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# [국내주식] 순위분석 > 국내주식 신고_신저근접종목 상위 [FHPST01870000]
NEAR_NEW_HIGHLOW_URL = "/uapi/domestic-stock/v1/ranking/near-new-highlow"
NEAR_NEW_HIGHLOW_TR_ID = "FHPST01870000"

# [국내주식] 종목정보 > 주식기본조회 [CTPF1002R]
SEARCH_STOCK_INFO_URL = "/uapi/domestic-stock/v1/quotations/search-stock-info"
SEARCH_STOCK_INFO_TR_ID = "CTPF1002R"


def fetch_near_new_highlow(tr_cont: str = "", dataframe: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """
    52주 신고/신저 근접종목 상위 API를 호출하여 전체 데이터를 수집합니다. (연속조회 포함)
    """
    params = {
        "fid_aply_rang_vol": "0",          # 거래량 전체
        "fid_cond_mrkt_div_code": "J",      # 주식
        "fid_cond_scr_div_code": "20187",  # 화면분류코드
        "fid_div_cls_code": "0",           # 전체
        "fid_input_cnt_1": "0",            # 괴리율 최소 0%
        "fid_input_cnt_2": "0",            # 괴리율 최대 0% -> 신고가만 필터링
        "fid_prc_cls_code": "0",           # 0: 신고근접
        "fid_input_iscd": "0000",          # 전체 시장
        "fid_trgt_cls_code": "0",          # 전체
        "fid_trgt_exls_cls_code": "0",     # 전체 제외 없음
        "fid_aply_rang_prc_1": "0",        # 최저가 제한 없음
        "fid_aply_rang_prc_2": "0"         # 최고가 제한 없음
    }

    res = ka._url_fetch(NEAR_NEW_HIGHLOW_URL, NEAR_NEW_HIGHLOW_TR_ID, tr_cont, params)

    if res.isOK():
        body = res.getBody()
        if hasattr(body, 'output') and body.output:
            current_data = pd.DataFrame(body.output)
        else:
            current_data = pd.DataFrame()

        if dataframe is not None:
            dataframe = pd.concat([dataframe, current_data], ignore_index=True)
        else:
            dataframe = current_data

        # 연속 거래 여부 확인 (tr_cont)
        next_tr_cont = res.getHeader().tr_cont
        if next_tr_cont == "M":
            logger.info("연속 데이터를 추가 조회합니다...")
            ka.smart_sleep()
            return fetch_near_new_highlow("N", dataframe)
        else:
            logger.info("신고가 근접종목 수집 완료.")
            return dataframe
    else:
        logger.error(f"신고가 API 호출 실패: {res.getErrorCode()} - {res.getErrorMessage()}")
        res.printError(NEAR_NEW_HIGHLOW_URL)
        return dataframe if dataframe is not None else pd.DataFrame()


def fetch_sector_info(stock_code: str) -> Optional[str]:
    """
    주식기본조회 API를 호출하여 해당 종목의 업종(섹터)명을 반환합니다.
    """
    params = {
        "PRDT_TYPE_CD": "300",  # 주식
        "PDNO": stock_code      # 종목코드
    }

    res = ka._url_fetch(SEARCH_STOCK_INFO_URL, SEARCH_STOCK_INFO_TR_ID, "", params)

    if res.isOK():
        body = res.getBody()
        if hasattr(body, "output") and body.output:
            output = body.output
            if isinstance(output, list) and len(output) > 0:
                output = output[0]
            
            # bstp_kor_isnm 또는 idx_bztp_scls_cd_name 필드 중 존재하는 값을 업종명으로 사용
            sector = None
            if hasattr(output, "bstp_kor_isnm") and getattr(output, "bstp_kor_isnm"):
                sector = getattr(output, "bstp_kor_isnm")
            elif hasattr(output, "idx_bztp_scls_cd_name") and getattr(output, "idx_bztp_scls_cd_name"):
                sector = getattr(output, "idx_bztp_scls_cd_name")
            elif isinstance(output, dict):
                sector = output.get("bstp_kor_isnm") or output.get("idx_bztp_scls_cd_name")
            
            return sector
    else:
        logger.warning(f"종목({stock_code}) 업종 정보 조회 실패: {res.getErrorCode()} - {res.getErrorMessage()}")
    return None


def main():
    # 1. KIS 실전투자 토큰 발급 및 초기화
    logger.info("KIS OpenAPI 실전투자 토큰 발급 및 초기화를 시작합니다.")
    ka.auth()

    # 2. 전체 신고가 근접종목 수집 (괴리율 0%)
    logger.info("52주 신고가 근접종목 조회를 시작합니다.")
    raw_df = fetch_near_new_highlow()

    if raw_df.empty:
        logger.error("수집된 종목 데이터가 없습니다.")
        return

    # 3. 52주 신고가 도달 종목 필터링 (안전한 숫자형 비교)
    # - hprc_near_rate가 0.00이거나
    # - stck_prpr(현재가) 와 new_hgpr(52주 최고가)가 완전히 일치하는 종목
    raw_df['hprc_near_rate_num'] = pd.to_numeric(raw_df['hprc_near_rate'], errors='coerce')
    raw_df['stck_prpr_num'] = pd.to_numeric(raw_df['stck_prpr'], errors='coerce')
    raw_df['new_hgpr_num'] = pd.to_numeric(raw_df['new_hgpr'], errors='coerce')

    filtered_df = raw_df[
        (raw_df['hprc_near_rate_num'] == 0.0) | 
        (raw_df['stck_prpr_num'] == raw_df['new_hgpr_num'])
    ].copy()

    if filtered_df.empty:
        print("\n=== 52주 신고가 현황 ===")
        print("전체 종목수: 0개\n")
        print("신고가 도달 종목이 없습니다.")
        return

    # 종목코드 컬럼명 확정 (API 버전에 따른 유연한 대응)
    code_col = 'mksc_shrn_iscd' if 'mksc_shrn_iscd' in filtered_df.columns else 'stck_shrn_iscd'
    if code_col not in filtered_df.columns:
        iscd_cols = [c for c in filtered_df.columns if 'iscd' in c or 'code' in c]
        code_col = iscd_cols[0] if iscd_cols else None

    if not code_col:
        logger.error("종목코드 컬럼을 찾을 수 없습니다.")
        return

    # 4. 각 종목별 업종(섹터) 정보 수집
    logger.info(f"필터링 완료된 {len(filtered_df)}개 종목의 업종 정보를 조회합니다.")
    sectors = []
    
    for idx, row in filtered_df.iterrows():
        stock_code = row[code_col]
        stock_name = row.get('hts_kor_isnm') or row.get('hts_kor_alph_lnm') or stock_code
        
        logger.info(f"[{idx + 1}/{len(filtered_df)}] {stock_name} ({stock_code}) 업종 조회 중...")
        sector = fetch_sector_info(stock_code)
        
        sectors.append(sector or "미분류")
        
        # API Rate Limit (초당 조회수 제한) 초과 방지를 위해 0.1초 대기
        time.sleep(0.1)

    filtered_df['sector'] = sectors

    # 5. 데이터 집계 및 정렬
    # 업종별 개수를 집계하고 내림차순 정렬
    sector_summary = filtered_df.groupby('sector').size().reset_index(name='count')
    sector_summary = sector_summary.sort_values(by='count', ascending=False)

    # 6. 최종 결과 출력
    print("\n=== 52주 신고가 현황 ===")
    print(f"전체 종목수: {len(filtered_df)}개\n")
    print("업종별 집계:")
    for _, row in sector_summary.iterrows():
        print(f"{row['sector']:<20} {row['count']}개")


if __name__ == "__main__":
    main()
