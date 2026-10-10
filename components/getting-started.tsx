import { FileSpreadsheet, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GettingStarted({ add, upload, dismiss }: { add: () => void; upload: () => void; dismiss: () => void }) {
  return <section className="relative overflow-hidden rounded-[26px] border border-[#b8deda] bg-gradient-to-br from-[#e8faf4] via-white to-[#eef5ff] p-5 shadow-sm sm:p-7">
    <button onClick={dismiss} className="absolute right-4 top-4 rounded-lg p-1 text-[#6d7d8b] hover:bg-white" aria-label="사용 안내 닫기"><X size={18}/></button>
    <span className="inline-flex rounded-full bg-[#c9f2e6] px-3 py-1 text-xs font-bold text-[#146b57]">처음 오셨나요?</span>
    <h2 className="mt-3 text-2xl font-black tracking-[-.04em]">3분이면 우리장부 시작!</h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#506874]">샘플 데이터는 넣지 않았어요. 아래 예시를 참고해 내 기록부터 편하게 시작해보세요.</p>
    <div className="mt-5 grid gap-3 md:grid-cols-3">
      <div className="rounded-2xl bg-white/85 p-4"><b className="text-[#146b57]">1 · 한 건 기록</b><p className="mt-2 text-sm text-[#637682]">예: <b>스타벅스 · 5,000원 · 식비</b></p><Button className="mt-4 w-full" size="sm" onClick={add}><Plus/>거래 입력</Button></div>
      <div className="rounded-2xl bg-white/85 p-4"><b className="text-[#2d5ca5]">2 · 카드 내역 가져오기</b><p className="mt-2 text-sm text-[#637682]">카드·은행 XLS, XLSX, CSV를 올리면 자동으로 정리해요.</p><Button className="mt-4 w-full" size="sm" variant="outline" onClick={upload}><FileSpreadsheet/>파일 가져오기</Button></div>
      <div className="rounded-2xl bg-white/85 p-4"><b className="text-[#a0641d]">3 · 필요할 때만 공유</b><p className="mt-2 text-sm text-[#637682]">설정에서 Google 로그인 후 가족 초대 코드를 만들 수 있어요.</p><p className="mt-4 text-xs font-semibold text-[#687985]">로그인 없이도 개인 장부는 저장됩니다.</p></div>
    </div>
    <button onClick={dismiss} className="mt-5 text-sm font-semibold text-[#287b67] underline underline-offset-4">이해했어요, 빈 장부로 시작하기</button>
  </section>;
}
