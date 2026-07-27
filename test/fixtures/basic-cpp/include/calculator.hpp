#pragma once

class Arithmetic {
public:
    virtual ~Arithmetic() = default;
};

class Calculator : public Arithmetic {
public:
    int add(int left, int right) const;
    int sumTo(int value) const;
};

class ScientificCalculator : public Calculator {};
