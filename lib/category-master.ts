export const transactionCategories = [
  "식비",
  "관리비",
  "생활용품",
  "교통비",
  "주유",
  "차량관리",
  "의료비",
  "운동",
  "쇼핑",
  "통신·구독",
  "보험",
  "교육·육아",
  "여행·여가",
  "경조사·선물",
  "계모임",
  "세금·공과금",
  "금융수수료",
  "급여",
  "기타·미분류",
] as const;

export type TransactionCategory = (typeof transactionCategories)[number];

export const merchantCategoryRules: { keyword: string; category: TransactionCategory }[] = [
  { keyword: "올리브영", category: "쇼핑" },
  { keyword: "이마트", category: "식비" },
  { keyword: "홈플러스", category: "식비" },
  { keyword: "롯데마트", category: "식비" },
  { keyword: "코스트코", category: "식비" },
  { keyword: "하나로마트", category: "식비" },
  { keyword: "대형마트", category: "식비" },
  { keyword: "병원", category: "의료비" },
  { keyword: "의원", category: "의료비" },
  { keyword: "약국", category: "의료비" },
  { keyword: "한의원", category: "의료비" },
  { keyword: "치과", category: "의료비" },
  { keyword: "철도", category: "교통비" },
  { keyword: "코레일", category: "교통비" },
  { keyword: "티머니", category: "교통비" },
  { keyword: "카카오T", category: "교통비" },
  { keyword: "택시", category: "교통비" },
  { keyword: "하이패스", category: "교통비" },
  { keyword: "교통", category: "교통비" },
  { keyword: "주유", category: "주유" },
  { keyword: "오일뱅크", category: "주유" },
  { keyword: "칼텍스", category: "주유" },
  { keyword: "S-OIL", category: "주유" },
  { keyword: "카센터", category: "차량관리" },
  { keyword: "정비", category: "차량관리" },
  { keyword: "세차", category: "차량관리" },
  { keyword: "헬스", category: "운동" },
  { keyword: "필라테스", category: "운동" },
  { keyword: "수영", category: "운동" },
  { keyword: "요가", category: "운동" },
  { keyword: "보험", category: "보험" },
  { keyword: "넷플릭스", category: "통신·구독" },
  { keyword: "유튜브", category: "통신·구독" },
  { keyword: "멜론", category: "통신·구독" },
  { keyword: "구독", category: "통신·구독" },
  { keyword: "계비", category: "계모임" },
  { keyword: "친목회", category: "계모임" },
  { keyword: "동창회", category: "계모임" },
  { keyword: "모임회비", category: "계모임" },
  { keyword: "다이소", category: "생활용품" },
  { keyword: "생활용품", category: "생활용품" },
  { keyword: "카페", category: "식비" },
  { keyword: "커피", category: "식비" },
  { keyword: "식당", category: "식비" },
  { keyword: "배달", category: "식비" },
  { keyword: "쿠팡이츠", category: "식비" },
  { keyword: "배민", category: "식비" },
];

export function inferTransactionCategory(merchant: string): TransactionCategory {
  const normalized = merchant.replace(/\s+/g, "").toLocaleLowerCase("ko");
  const rule = merchantCategoryRules.find(({ keyword }) =>
    normalized.includes(keyword.replace(/\s+/g, "").toLocaleLowerCase("ko")),
  );
  return rule?.category ?? "기타·미분류";
}

export function isTransactionCategory(value: string): value is TransactionCategory {
  return (transactionCategories as readonly string[]).includes(value);
}
