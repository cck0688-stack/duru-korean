-- DURU KOREAN — 설치 확인용 조회
--
-- schema.sql 을 실행한 뒤, 제대로 만들어졌는지 눈으로 확인하는 용도입니다.
-- 아무것도 바꾸지 않고 읽기만 하므로 몇 번을 실행해도 안전합니다.
--
-- 대시보드 → SQL Editor → New query 에 붙여넣고 Run 을 누르세요.
-- 아래 4줄이 나오면 정상입니다.
--
--   테이블                          RLS 보안   정책 수
--   admin_users                     켜짐        1
--   keep_alive                      켜짐        1
--   resources                       켜짐        3
--   storage.objects (파일 저장소)   켜짐        3
--
-- 줄이 빠져 있으면 그 테이블이 안 만들어진 것이고, "RLS 보안"이 꺼짐이면
-- 데이터가 무방비 상태라는 뜻입니다. 둘 중 하나라도 어긋나면
-- schema.sql 을 다시 실행하세요 (몇 번을 실행해도 안전합니다).

select
  t.tablename                                   as "테이블",
  case when t.rowsecurity then '켜짐' else '꺼짐 (문제!)' end as "RLS 보안",
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.tablename) as "정책 수"
from pg_tables t
where t.schemaname = 'public'
  and t.tablename in ('resources', 'admin_users', 'keep_alive')
union all
select
  'storage.objects (파일 저장소)',
  '켜짐',
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'resources bucket%')
order by 1;
