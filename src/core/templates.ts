/**
 * 시작 템플릿.
 * 빈 화면은 초보자를 쫓아낸다. 처음 여는 사람이 고를 것이 있어야 한다.
 */
export interface Template {
  id: string
  name: string
  desc: string
  category: '기본' | '업무' | '기술' | '기타'
  code: string
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: '빈 문서',
    desc: '도형 하나로 시작',
    category: '기본',
    code: 'flowchart TD\n    A[시작]\n',
  },
  {
    id: 'flow',
    name: '기본 흐름도',
    desc: '조건 분기가 있는 순서도',
    category: '기본',
    code: `flowchart TD
    A[시작] --> B{조건을 만족하나?}
    B -->|예| C[처리한다]
    B -->|아니오| D[건너뛴다]
    C --> E[결과 저장]
    D --> E
    E --> F((끝))
`,
  },
  {
    id: 'approval',
    name: '결재 프로세스',
    desc: '요청 → 검토 → 승인/반려',
    category: '업무',
    code: `flowchart LR
    A([요청 접수]) --> B[담당자 검토]
    B --> C{승인 가능?}
    C -->|승인| D[결재 처리]
    C -->|보완 필요| E[반려 및 사유 전달]
    E --> A
    D --> F[(결과 기록)]
    F --> G([완료])

    style D fill:#16a34a,stroke:#15803d,color:#ffffff
    style E fill:#dc2626,stroke:#b91c1c,color:#ffffff
`,
  },
  {
    id: 'org',
    name: '조직도',
    desc: '팀 구조',
    category: '업무',
    code: `flowchart TD
    CEO[대표이사] --> A[사업본부]
    CEO --> B[기술본부]
    CEO --> C[경영지원]
    A --> A1[영업팀]
    A --> A2[마케팅팀]
    B --> B1[개발팀]
    B --> B2[데이터팀]
    C --> C1[인사팀]
    C --> C2[재무팀]
`,
  },
  {
    id: 'system',
    name: '시스템 구성도',
    desc: '서비스 · 저장소 · 외부 연동',
    category: '기술',
    code: `flowchart TB
    subgraph client [사용자]
        U[웹 브라우저]
        M[모바일 앱]
    end

    subgraph server [서버]
        API[API 게이트웨이]
        S1[인증 서비스]
        S2[업무 서비스]
    end

    DB[(주 데이터베이스)]
    CACHE[(캐시)]
    EXT[외부 결제 API]

    U --> API
    M --> API
    API --> S1
    API --> S2
    S1 --> DB
    S2 --> DB
    S2 --> CACHE
    S2 --> EXT
`,
  },
  {
    id: 'pipeline',
    name: '데이터 파이프라인',
    desc: '수집 → 변환 → 적재',
    category: '기술',
    code: `flowchart LR
    A[(원천 DB)] --> B[/추출/]
    C[로그 파일] --> B
    B --> D[정제]
    D --> E{품질 검사}
    E -->|통과| F[변환]
    E -->|실패| G[격리 저장소]
    F --> H[(분석 DB)]
    H --> I[대시보드]

    style E fill:#eab308,stroke:#ca8a04,color:#422006
    style G fill:#dc2626,stroke:#b91c1c,color:#ffffff
`,
  },
  {
    id: 'sequence',
    name: '시퀀스 다이어그램',
    desc: '주고받는 순서 (코드 전용)',
    category: '기술',
    code: `sequenceDiagram
    participant U as 사용자
    participant A as 앱
    participant S as 서버
    U->>A: 로그인 버튼
    A->>S: 인증 요청
    S-->>A: 토큰 발급
    A-->>U: 홈 화면
`,
  },
  {
    id: 'state',
    name: '상태 다이어그램',
    desc: '상태 전이 (코드 전용)',
    category: '기술',
    code: `stateDiagram-v2
    [*] --> 대기
    대기 --> 처리중: 요청 도착
    처리중 --> 완료: 성공
    처리중 --> 실패: 오류
    실패 --> 대기: 재시도
    완료 --> [*]
`,
  },
  {
    id: 'mindmap',
    name: '마인드맵',
    desc: '생각 정리 (코드 전용)',
    category: '기타',
    code: `mindmap
  root((신규 서비스))
    시장
      경쟁사
      고객군
    제품
      핵심 기능
      차별점
    운영
      인력
      비용
`,
  },
  {
    id: 'er',
    name: 'ER 다이어그램',
    desc: '테이블 관계 (코드 전용)',
    category: '기술',
    code: `erDiagram
    고객 ||--o{ 주문 : "주문한다"
    주문 ||--|{ 주문상세 : "포함한다"
    상품 ||--o{ 주문상세 : "담긴다"
    고객 {
        int 고객번호 PK
        string 이름
        string 연락처
    }
    주문 {
        int 주문번호 PK
        date 주문일자
    }
`,
  },
  {
    id: 'gantt',
    name: '간트 차트',
    desc: '일정 (코드 전용)',
    category: '업무',
    code: `gantt
    title 프로젝트 일정
    dateFormat YYYY-MM-DD
    section 기획
    요구사항 정리      :a1, 2026-10-01, 10d
    설계               :a2, after a1, 12d
    section 개발
    구현               :b1, after a2, 25d
    테스트             :b2, after b1, 10d
    section 출시
    배포               :c1, after b2, 3d
`,
  },
  {
    id: 'journey',
    name: '사용자 여정',
    desc: '만족도 흐름 (코드 전용)',
    category: '업무',
    code: `journey
    title 신규 가입 여정
    section 발견
      광고 클릭: 3: 사용자
      랜딩 확인: 4: 사용자
    section 가입
      약관 동의: 2: 사용자
      정보 입력: 2: 사용자
    section 사용
      첫 기능 사용: 5: 사용자
`,
  },
]

export function templatesByCategory(): { category: Template['category']; items: Template[] }[] {
  const order: Template['category'][] = ['기본', '업무', '기술', '기타']
  return order
    .map(category => ({ category, items: TEMPLATES.filter(t => t.category === category) }))
    .filter(g => g.items.length > 0)
}
