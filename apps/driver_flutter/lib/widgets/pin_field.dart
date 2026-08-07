import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// حقل رمز من أربعة أرقام.
///
/// الرمز يُملى شفهياً بين طرفين، فالخطأ المطبعي أشيع من الخطأ الأمني —
/// لذلك أرقام فقط وطول محدود ولوحة رقمية وتباعد يجعل القراءة سهلة.
class PinField extends StatelessWidget {
  const PinField({
    super.key,
    required this.controller,
    this.label = 'الرمز',
    this.autofocus = false,
  });

  final TextEditingController controller;
  final String label;
  final bool autofocus;

  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        autofocus: autofocus,
        keyboardType: TextInputType.number,
        textDirection: TextDirection.ltr,
        textAlign: TextAlign.center,
        maxLength: 4,
        style: const TextStyle(fontSize: 28, letterSpacing: 12),
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: InputDecoration(
          labelText: label,
          counterText: '',
          border: const OutlineInputBorder(),
        ),
      );
}
