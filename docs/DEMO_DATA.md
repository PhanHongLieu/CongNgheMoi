# Demo data

File seed:

```txt
infra/db/init/02_demo_seed.sql
```

Mat khau demo cho cac tai khoan ACTIVE:

```txt
123456
```

Tai khoan demo nhanh:

| Vai tro | Employee code | Email | Ghi chu |
| --- | --- | --- | --- |
| Admin | `00000001` | `admin@mdp.local` | Super admin neu database chua co super admin khac, neu da co thi la admin |
| Project Manager | `00000002` | `manager@mdp.local` | Demo Project Management |
| HR Manager | `00000003` | `hr@mdp.local` | Demo HR Administration |
| Site Supervisor | `00000004` | `supervisor@mdp.local` | Demo quan ly hien truong |
| Locked Employee | `00000005` | `locked@mdp.local` | Demo tai khoan bi khoa |
| Inactive Employee | `00000006` | `inactive@mdp.local` | Demo tai khoan inactive |
| Employee | `00000101` | `prep01@mdp.local` | Demo cham cong thanh cong |
| Equipment Operator | `00000502` | `equipment02@mdp.local` | Demo driver/equipment allocation |

Du lieu co san:

- 4 du an: `PRJ-DEMO-001` den `PRJ-DEMO-004`
- 30 nhan su chia deu theo trade: `PREPARATION`, `FOUNDATION`, `STRUCTURE`, `FINISHING`, `EQUIPMENT`, `WAREHOUSE`
- Project stages, WBS child tasks, progress updates
- Workforce quota requests va work schedules
- Attendance cases: present, late, early leave, open check-in, absent
- Attendance exception cases: `MISSING_OUT`, OT pending approval, approved leave day
- Leave/overtime/forgot-checkout requests: pending, approved, rejected
- Materials inventory, daily usage, over-import, over-usage, low-stock
- Project costs: material, labor, equipment, transport, safety, other
- Equipment assets/logs, RFx, construction diaries, acceptance records
- Payroll settings/salaries, holidays, notifications, audit logs

Request demo nhanh:

| Request | Loai | Trang thai | Nhan su |
| --- | --- | --- | --- |
| `REQ-DEMO-001` | Leave | `PENDING` | `00000102` |
| `REQ-DEMO-002` | Overtime | `APPROVED` | `00000201` |
| `REQ-DEMO-003` | Forgot checkout | `REJECTED` | `00000503` |
| `REQ-DEMO-004` | Leave | `APPROVED` | `00000103` |
| `REQ-DEMO-005` | Leave | `REJECTED` | `00000203` |
| `REQ-DEMO-006` | Overtime | `PENDING` | `00000202` |
| `REQ-DEMO-007` | Forgot checkout / MISSING_OUT | `PENDING` | `00000601` |
| `REQ-DEMO-008` | Forgot checkout / late check-in + MISSING_OUT | `PENDING` | `00000602` |
| `REQ-DEMO-009` | Overtime / late checkout | `APPROVED` | `00000504` |
| `REQ-DEMO-010` | Leave / half-day leave + late afternoon check-in | `APPROVED` | `00000403` |

Chay tren local Docker Postgres:

```powershell
Get-Content infra\db\init\02_demo_seed.sql | docker exec -i mdp-postgres psql -U mdp_user -d mdp_system -p 6543
```

Chay tren Supabase/hosted Postgres bang Docker:

```powershell
Get-Content infra\db\init\02_demo_seed.sql | docker run -i --rm postgres:16 psql "<DATABASE_URL>"
```

Neu dang dung CMD thay PowerShell:

```cmd
type infra\db\init\02_demo_seed.sql | docker run -i --rm postgres:16 psql "<DATABASE_URL>"
```

Luu y: script se xoa va tao lai rieng cac record demo co ma `PRJ-DEMO-*` va employee code/email demo trong file. Khong xoa du lieu ngoai nhom demo nay.
