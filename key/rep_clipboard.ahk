#Persistent ; 让脚本持续运行
OnClipboardChange:
 ToolTip  copy: "%clipboard%".
    IniRead, OutputVar, .\zhishiku.ini, Options,%clipboard% 
    if ( InStr(OutputVar,"err")>0)
      {
      Sleep 100
      ToolTip
      return
      }
   else 
     {
;    MsgBox, The value is %OutputVar%.ture
    Sleep 100
    ToolTip  ; 关闭工具提示.
    Sleep 100
   clipboard :=  OutputVar  ; 在剪贴板中存入新内容.
   Sleep 100
    }
#C::  ; 设定热键win+c来开始当前脚本
sleep 300
msgbox, 鼠标位置确定后start(spacce)! "win+x"强行结束!
sleep 500
StartTime := A_TickCount
loop,
{
WinWait, jmrep1 实时态 实时数据浏览 - 保护节点表 [SCADA jmsca1-1], 
IfWinNotActive, jmrep1 实时态 实时数据浏览 - 保护节点表 [SCADA jmsca1-1], , WinActivate, jmrep1 实时态 实时数据浏览 - 保护节点表 [SCADA jmsca1-1], 
WinWaitActive, jmrep1 实时态 实时数据浏览 - 保护节点表 [SCADA jmsca1-1], 
MouseClick, left,
Sleep, 100
Send, {CTRLDOWN}a{CTRLUP}{CTRLDOWN}c{CTRLUP}
  sleep 200
MouseClick, left,
Sleep, 100
Send, {CTRLDOWN}a{CTRLUP}{CTRLDOWN}v{CTRLUP}
  sleep 10
  mousemove,0,32,1,R
  if mod(A_Index,24)<>0
  continue
  MouseClick,WheelDown,,,8
  MouseMove,0,-768,5,R
  if ( A_Index > 239 )
     {
     break
     }
}
ElapsedTime := (A_TickCount - StartTime)/60000
msgbox,本次共使用了 %ElapsedTime% 分
msgbox,,,save and win+C restart,2
return

#x::ExitApp  ; 设定热键win+x来终止当前脚本