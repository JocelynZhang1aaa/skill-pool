summary_text 示例（桌球对局 · 直接可注入模型 prompt）

场景一：对局结束（event: complete / win / lose）

示例输出：

用户与 {bot_name}（bot_id: {bot_id}）于 {date} {time} 进行了一局「skill-pool」美式8球桌球对局。

{outcome_desc}。共进行了 {total_shots} 杆。

对局记录：
1. [开球] 用户开球，{break_result}（进袋：{break_pocketed}）。定花色：用户 → {user_group}，{bot_name} → {bot_group}
2. [第N杆·{shooter}] {shot_desc}
   进袋：{pocketed_balls} | 首碰：{first_contact}
3. ...
{foul_records}

最终比分：用户清袋 {user_pocketed}/{user_total}，{bot_name}清袋 {bot_pocketed}/{bot_total}。
胜负原因：{win_reason}


---

场景二：对局中断/中途退出（event: interrupt / timeout）

示例输出：

用户与 {bot_name}（bot_id: {bot_id}）于 {date} {time} 开始「skill-pool」美式8球桌球对局。

对局进行到第 {current_shot} 杆时中断。当前比分：用户清袋 {user_pocketed}/7，{bot_name}清袋 {bot_pocketed}/7。

当前局面：
- 用户花色：{user_group}（剩余 {user_left} 颗）
- {bot_name}花色：{bot_group}（剩余 {bot_left} 颗）
- 黑8状态：{eight_status}
- 当前轮次：{current_turn}

已完成的回合记录：
1. [开球] {break_result}
2. ...

用户行为摘要：
- 中断前最后动作：{last_action}
- 整体表现：{performance_summary}
