#Persistent ; 让脚本持续运行
OnClipboardChange("ClipChanged")
loop,3
{
  clipboard := "试看看"
  msgbox, 第%a_index%次操作完成！
}
return
ClipChanged(clip_type) {    
    ToolTip  copy: "%clipboard%".
    IniRead, OutputVar, .\MacroCreator.ini, Options,%clipboard% 
    if ( InStr(OutputVar,"err")>0)
      {
      Sleep 1000
      ToolTip
      return
      }
   else 
     {
    MsgBox, The value is %OutputVar%.ture
    Sleep 1000
    ToolTip  ; 关闭工具提示.
    Sleep 1000
   clipboard :=  OutputVar  ; 在剪贴板中存入新内容.
   Sleep 1000
  MsgBox,sleep
    }
}

#x::ExitApp  ; 设定热键来终止当前脚本